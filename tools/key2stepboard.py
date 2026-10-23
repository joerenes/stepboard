#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["keynote-parser==1.14.5.0", "pypdfium2>=4.30", "Pillow>=10.0"]
# ///
"""
key2stepboard: convert an Apple Keynote file into a Stepboard import file.

    uv run tools/key2stepboard.py lecture.key             # writes lecture.stepboard-import.json
    uv run tools/key2stepboard.py lecture.key -o out.json

uv reads the dependency list at the top of this file and runs the script in its own cached environment,
so nothing is installed into your system Python. (Without uv: pip install -r tools/requirements.txt,
then python3 tools/key2stepboard.py lecture.key.)

Open the result in Stepboard with "Open file"; the editor builds the slides from it.

What is converted
  * slides, in presentation order (skipped slides are left out unless --include-skipped)
  * pencil drawings: every stroke as an editable tldraw stroke with its colour and width
    (Keynote's crayon/brush texture is not reproduced; those strokes come out solid)
  * text boxes and visible title placeholders: plain text, approximate size, colour and alignment
  * images (PNG, JPEG, GIF, WebP, SVG as they are; PDF images such as pasted equations are rendered to
    sharp PNGs; TIFF/BMP converted to PNG), with position, size and rotation
  * slide background colours
  * builds: "In" builds become steps where the object appears, "Out" builds steps where it disappears;
    a build set to start automatically (with / after the previous one) joins the previous step
What is not converted (yet): image cropping (the whole image is shown), shapes other than strokes, tables,
charts, movies, background images, transitions, notes.

Needs keynote-parser 1.14.5 (reads Keynote 14 and 15 files), pypdfium2 and Pillow; uv installs them.
"""
import argparse
import base64
import io
import json
import math
import os
import re
import sys
import warnings
import zipfile

# keynote-parser warns about every Keynote record it has no schema for (style patches and the like);
# they don't affect the conversion, so they are hidden unless --verbose is given.
if '--verbose' not in sys.argv:
    warnings.filterwarnings('ignore')

try:
    from keynote_parser.codec import IWAFile
except ImportError:
    sys.exit('key2stepboard needs keynote-parser: pip install keynote-parser==1.14.5.0')

FORMAT = 'stepboard-import'


# ---------------------------------------------------------------- reading the Keynote archive

def read_archives(path):
    """All objects in the .key file, keyed by identifier: {id: (pbtype, object)}."""
    objs = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.endswith('.iwa'):
                continue
            try:
                data = IWAFile.from_buffer(z.read(name), name).to_dict()
            except Exception as e:  # an unreadable archive (e.g. a newer Keynote); skip it
                print(f'warning: could not read {name}: {e}', file=sys.stderr)
                continue
            for chunk in data.get('chunks', []):
                for arc in chunk.get('archives', []):
                    ident = arc['header']['identifier']
                    if arc.get('objects'):
                        objs[str(ident)] = arc['objects'][0]
    if not objs:
        raise SystemExit(f'{path}: no Keynote data found. Is this a .key file saved as a single file?')
    return objs


def media_index(path):
    """Image files in the package's Data folder, keyed by the data identifier at the end of their name."""
    out = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            m = re.match(r'^Data/(.+)-(\d+)\.(\w+)$', name)
            if m:
                out[m.group(2)] = name
    return out


MIME = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
        'webp': 'image/webp', 'svg': 'image/svg+xml'}


def web_image(name, raw, display_w):
    """(mime, bytes, pixel width, pixel height) of an image a browser can show, converting if needed."""
    ext = name.rsplit('.', 1)[-1].lower()
    if ext == 'pdf':
        import pypdfium2 as pdfium
        page = pdfium.PdfDocument(raw)[0]
        pw, _ = page.get_size()
        # Render at 3x the size it is shown at on the 1920-wide slide, so it stays sharp on a projector.
        scale = max(1.0, min(4000 / pw, 3 * max(display_w, 1) / pw))
        img = page.render(scale=scale).to_pil()
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True)
        return 'image/png', buf.getvalue(), img.width, img.height
    from PIL import Image
    if ext in MIME and ext != 'svg':
        with Image.open(io.BytesIO(raw)) as im:
            return MIME[ext], raw, im.width, im.height
    if ext == 'svg':
        return MIME['svg'], raw, 0, 0
    with Image.open(io.BytesIO(raw)) as im:  # TIFF, BMP, ...; raises for formats Pillow can't read (e.g. HEIC)
        im = im.convert('RGBA')
        buf = io.BytesIO()
        im.save(buf, 'PNG', optimize=True)
        return 'image/png', buf.getvalue(), im.width, im.height


class Media:
    """Loads, converts and de-duplicates the images used by the slides."""
    def __init__(self, path):
        self.path = path
        self.index = media_index(path)
        self.assets = {}

    def asset(self, data_id, display_w, warnings):
        name = self.index.get(str(data_id))
        if not name:
            warnings.add('an image whose file is missing from the Keynote package')
            return None
        if name in self.assets:
            return name
        with zipfile.ZipFile(self.path) as z:
            raw = z.read(name)
        try:
            mime, data, pw, ph = web_image(name, raw, display_w)
        except Exception as e:
            warnings.add(f'an image that could not be converted ({os.path.basename(name)}: {e})')
            return None
        self.assets[name] = {'name': os.path.basename(name), 'mime': mime, 'w': pw, 'h': ph,
                             'src': f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')}
        return name


def ref(o, *keys):
    """Follow nested keys to a {'identifier': ...} reference; return the id or None."""
    for k in keys:
        if not isinstance(o, dict) or k not in o:
            return None
        o = o[k]
    return str(o['identifier']) if isinstance(o, dict) and 'identifier' in o else None


# ---------------------------------------------------------------- styles

def style_chain(objs, sid):
    chain, seen = [], set()
    while sid and sid in objs and sid not in seen:
        seen.add(sid)
        o = objs[sid]
        chain.append(o)
        sid = ref(o, 'super', 'parent') or ref(o, 'super', 'super', 'parent')
    return chain


def style_prop(objs, sid, *path):
    """First value found for path walking up the style's parent chain."""
    for o in style_chain(objs, sid):
        for base in (o, o.get('super', {})):
            v = base
            for k in path:
                v = v.get(k) if isinstance(v, dict) else None
            if v not in (None, {}, []):
                return v
    return None


def hex_color(c, default='#000000'):
    if not isinstance(c, dict) or 'r' not in c:
        return default
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c.get(k, 0) * 255))) for k in 'rgb')


def stroke_style(objs, sid):
    """Stroke colour/width/brush, or None when the shape has no visible outline."""
    st = style_prop(objs, sid, 'shapeProperties', 'stroke') or {}
    if (st.get('pattern') or {}).get('type') == 'TSDEmptyPattern' or not st.get('width', 1):
        return None
    return {
        'color': hex_color(st.get('color')),
        'width': float(st.get('width', 3.0)),
        'brush': (st.get('smartStroke') or {}).get('strokeName'),
    }


def fill_color(objs, sid, warnings):
    """A shape's fill as one colour (gradients use their first colour), or None."""
    f = style_prop(objs, sid, 'shapeProperties', 'fill') or {}
    if f.get('color'):
        return hex_color(f['color'])
    stops = (f.get('gradient') or {}).get('stops') or []
    if stops and stops[0].get('color'):
        warnings.add('gradient fills (the first colour is used)')
        return hex_color(stops[0]['color'])
    if f.get('image'):
        warnings.add('image fills of shapes')
    return None


def axis_rect(lines):
    """(x, y, w, h) when the path is a single axis-aligned rectangle, else None."""
    lines = [l for l in lines if len(l) > 1]  # Keynote paths often end with a stray moveTo
    if len(lines) != 1:
        return None
    pts = lines[0]
    xs = sorted({round(p[0], 1) for p in pts})
    ys = sorted({round(p[1], 1) for p in pts})
    x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    on_edge = all(min(abs(p[0] - x0), abs(p[0] - x1)) < 0.6 or min(abs(p[1] - y0), abs(p[1] - y1)) < 0.6 for p in pts)
    return (x0, y0, x1 - x0, y1 - y0) if on_edge else None


# ---------------------------------------------------------------- geometry

class Xf:
    """Affine transform (a b c d e f) as in SVG: x' = a x + c y + e, y' = b x + d y + f."""
    def __init__(self, a=1, b=0, c=0, d=1, e=0, f=0):
        self.m = (a, b, c, d, e, f)

    def __matmul__(self, o):
        a, b, c, d, e, f = self.m
        A, B, C, D, E, F = o.m
        return Xf(a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f)

    def apply(self, x, y):
        a, b, c, d, e, f = self.m
        return a * x + c * y + e, b * x + d * y + f


def geometry_xf(g, natural=None, hflip=False, vflip=False):
    """Transform from a drawable's local space to its parent: scale natural size to its size, flip, rotate, place."""
    pos = g.get('position', {})
    size = g.get('size', {})
    w, h = size.get('width', 0) or 0, size.get('height', 0) or 0
    nw, nh = (natural or {}).get('width', 0) or 0, (natural or {}).get('height', 0) or 0
    anchored = False
    if (not w or not h) and nw and nh:  # auto-sizing text boxes store no size; their natural size applies
        w, h, anchored = nw, nh, True
    sx = w / nw if nw else 1
    sy = h / nh if nh else 1
    xf = Xf(sx * (-1 if hflip else 1), 0, 0, sy * (-1 if vflip else 1), w if hflip else 0, h if vflip else 0)
    ang = math.radians(g.get('angle', 0) or 0)
    if ang:
        cx, cy = w / 2, h / 2
        cs, sn = math.cos(ang), math.sin(ang)
        # Keynote angles turn counter-clockwise on screen.
        xf = Xf(1, 0, 0, 1, cx, cy) @ Xf(cs, -sn, sn, cs, 0, 0) @ Xf(1, 0, 0, 1, -cx, -cy) @ xf
    return Xf(1, 0, 0, 1, pos.get('x', 0), pos.get('y', 0)) @ xf, w, h, anchored


def sample_path(elements, xf, step=2.5):
    """Flatten a Keynote bezier path into polylines (one per subpath), in slide coordinates."""
    lines, cur, start, last = [], [], None, None

    def emit(p):
        if not cur or math.dist(cur[-1], p) > 0.05:
            cur.append(p)

    for el in elements:
        t, pts = el.get('type'), [(p.get('x', 0), p.get('y', 0)) for p in el.get('points', [])]
        if t == 'moveTo' and pts:
            if len(cur) > 0:
                lines.append(cur)
            cur, start, last = [], pts[0], pts[0]
            emit(xf.apply(*pts[0]))
        elif t == 'lineTo' and pts and last is not None:
            a, b = xf.apply(*last), xf.apply(*pts[0])
            n = max(1, int(math.dist(a, b) / step))
            for i in range(1, n + 1):
                emit((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
            last = pts[0]
        elif t == 'curveTo' and len(pts) >= 3 and last is not None:
            p0, p1, p2, p3 = (xf.apply(*q) for q in (last, pts[0], pts[1], pts[2]))
            approx = math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)
            n = max(2, int(approx / step))
            for i in range(1, n + 1):
                u = i / n
                v = 1 - u
                emit((v**3 * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u**3 * p3[0],
                      v**3 * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u**3 * p3[1]))
            last = pts[2]
        elif t == 'closeSubpath' and start is not None:
            emit(xf.apply(*start))
            last = start
    if cur:
        lines.append(cur)
    return lines


# ---------------------------------------------------------------- text

ALIGN = {'TATvalue0': 'start', 'TATvalue1': 'end', 'TATvalue2': 'middle', 'TATvalue3': 'start', 'TATvalue4': 'start'}
LINE_BOX = 1.165   # glyph box height / font size for Keynote's default fonts (measured from a PDF export)
TEXT_INSET = 4.0   # Keynote's default text box inset


def table_at(table, index):
    """Value of a Keynote run table (entries sorted by characterIndex) at a character index."""
    found = None
    for e in (table or {}).get('entries', []):
        if e.get('characterIndex', 0) <= index:
            found = e
        else:
            break
    return found


VALIGN = {'kFrameAlignTop': 'top', 'kFrameAlignMiddle': 'middle', 'kFrameAlignBottom': 'bottom'}


def text_items(objs, shape, storage_id, xf, w, h, valign, pad):
    st = objs.get(storage_id)
    if not st or not st.get('text'):
        return []
    text = ''.join(st['text'])
    if not text.strip():
        return []
    paras, pos = [], 0
    for line in text.split('\n'):
        paras.append((pos, line))
        pos += len(line) + 1
    out, counters = [], {}
    layout = []
    for i, (start, line) in enumerate(paras):
        pe = table_at(st.get('tableParaStyle'), start)
        psid = ref(pe, 'object') if pe and 'object' in pe else None
        if psid is None:  # entry without its own style continues the previous one
            psid = layout[-1]['psid'] if layout else None
        ce = table_at(st.get('tableCharStyle'), start)
        csid = ref(ce, 'object') if ce else None
        fs = (csid and style_prop(objs, csid, 'charProperties', 'fontSize')) or style_prop(objs, psid, 'charProperties', 'fontSize') or 36.0
        color = hex_color((csid and style_prop(objs, csid, 'charProperties', 'fontColor')) or style_prop(objs, psid, 'charProperties', 'fontColor'))
        bold = bool((csid and style_prop(objs, csid, 'charProperties', 'bold')) or style_prop(objs, psid, 'charProperties', 'bold'))
        align = ALIGN.get(style_prop(objs, psid, 'paraProperties', 'alignment') or '', 'start')
        ls = style_prop(objs, psid, 'paraProperties', 'lineSpacing', 'amount') or 1.0
        sb = style_prop(objs, psid, 'paraProperties', 'spaceBefore') or 0.0
        sa = style_prop(objs, psid, 'paraProperties', 'spaceAfter') or 0.0
        # List numbering / bullets
        label = ''
        le = table_at(st.get('tableListStyle'), start)
        lsid = ref(le, 'object') if le and 'object' in le else None
        lst = objs.get(lsid) if lsid else None
        if lst and line.strip():
            kinds = lst.get('labelTypes') or []
            kind = kinds[0] if kinds else 'kNone'
            if kind == 'kNumber':
                counters[lsid] = counters.get(lsid, 0) + 1
                label = f'{counters[lsid]}.\t'
            elif kind in ('kBullet', 'kImage'):
                label = '•\t'
        layout.append({'psid': psid, 'fs': float(fs), 'ls': float(ls), 'sb': float(sb), 'sa': float(sa),
                       'text': (label.replace('\t', '  ') + line) if line else '', 'color': color, 'bold': bold, 'align': align})
    # Vertical layout: relative line spacing adds space below each line; spaceBefore is skipped on the first paragraph.
    total = 0.0
    for i, p in enumerate(layout):
        p['dy'] = total + (p['sb'] if i else 0.0)
        total = p['dy'] + p['fs'] * LINE_BOX * (p['ls'] if i < len(layout) - 1 else 1.0) + p['sa']
    inner = h - pad['top'] - pad['bottom']
    top = pad['top'] + {'top': 0, 'middle': (inner - total) / 2, 'bottom': inner - total}[valign]
    for p in layout:
        if not p['text'].strip():
            continue
        x0, y0 = xf.apply(pad['left'], top + p['dy'])
        x1, _ = xf.apply(w - pad['right'], top + p['dy'])
        out.append({'type': 'text', 'x': x0, 'y': y0, 'w': max(10.0, x1 - x0), 'text': p['text'], 'fontSize': p['fs'],
                    'color': p['color'], 'bold': p['bold'], 'align': p['align']})
    return out


# ---------------------------------------------------------------- slides

def image_item(objs, o, parent_xf, media, warnings):
    sp = o.get('super', {})
    natural = o.get('naturalSize') or {}
    xf = parent_xf @ geometry_xf(sp.get('geometry', {}), natural)[0]
    nw, nh = natural.get('width', 0) or 0, natural.get('height', 0) or 0
    if not nw or not nh:
        return []
    p0, p1, p3 = xf.apply(0, 0), xf.apply(nw, 0), xf.apply(0, nh)
    w, h = math.dist(p0, p1), math.dist(p0, p3)
    key = media.asset(ref(o, 'data'), w, warnings)
    if not key:
        return []
    if o.get('mask') or o.get('instantAlphaPath'):
        warnings.add('image cropping and instant alpha (the whole image is shown)')
    return [{'type': 'image', 'asset': key, 'x': p0[0], 'y': p0[1], 'w': w, 'h': h,
             'rotation': math.atan2(p1[1] - p0[1], p1[0] - p0[0])}]


def drawable_items(objs, did, parent_xf, warnings, media):
    """Strokes, text and images for one drawable (recursing into groups), in slide coordinates."""
    o = objs.get(did)
    if not o:
        return []
    t = o.get('_pbtype')
    if t == 'TSD.GroupArchive':
        g = o.get('super', {}).get('geometry', {})
        xf = geometry_xf(g)[0]
        items = []
        for ch in o.get('children', []):
            items += drawable_items(objs, str(ch['identifier']), parent_xf @ xf, warnings, media)
        return items
    if t in ('TSWP.ShapeInfoArchive', 'KN.PlaceholderArchive'):
        si = o if t == 'TSWP.ShapeInfoArchive' else o.get('super', {})
        sp = si.get('super', {})
        ps = sp.get('pathsource', {})
        bp = ps.get('bezierPathSource')
        g = sp.get('super', {}).get('geometry', {})
        natural = bp.get('naturalSize') if bp else None
        xf, w, h, anchored = geometry_xf(g, natural, ps.get('horizontalFlip', False), ps.get('verticalFlip', False))
        sid = ref(sp, 'style')
        valign = VALIGN.get(style_prop(objs, sid, 'shapeProperties', 'verticalAlignment') or '', 'top')
        pad = {k: TEXT_INSET for k in ('top', 'bottom', 'left', 'right')}
        pad.update(style_prop(objs, sid, 'shapeProperties', 'padding') or {})
        if anchored:
            # An auto-sizing text box grows from its stored position: vertically by its vertical alignment,
            # horizontally by its paragraph alignment.
            storage = ref(si, 'ownedStorage')
            st = objs.get(storage) or {}
            pe = table_at(st.get('tableParaStyle'), 0)
            halign = ALIGN.get(style_prop(objs, ref(pe, 'object') if pe else None, 'paraProperties', 'alignment') or '', 'start')
            dx = {'start': 0, 'middle': -w / 2, 'end': -w}[halign]
            dy = {'top': 0, 'middle': -h / 2, 'bottom': -h}[valign]
            xf = Xf(1, 0, 0, 1, dx, dy) @ xf
        xf = parent_xf @ xf
        if si.get('isTextBox'):
            storage = ref(si, 'ownedStorage') or ref(si, 'deprecatedStorage')
            return text_items(objs, si, storage, xf, w, h, valign, pad)
        if not bp:
            warnings.add('a shape type that is not converted yet')
            return []
        style = stroke_style(objs, sid)
        fill = fill_color(objs, sid, warnings)
        lines = sample_path(bp.get('path', {}).get('elements', []), xf)
        items = []
        rect = axis_rect(lines) if fill else None
        if rect:
            # Filled rectangles (backdrops, boxes) become tldraw rectangles.
            items.append({'type': 'rect', 'x': rect[0], 'y': rect[1], 'w': rect[2], 'h': rect[3], 'fill': fill,
                          **({'color': style['color'], 'width': style['width']} if style else {})})
        elif style or fill:
            for line in (l for l in lines if len(l) > 1 or not fill):
                it = {'type': 'stroke', 'points': [[round(x, 2), round(y, 2)] for x, y in line],
                      **(style or {'color': fill, 'width': 1.0})}
                if fill:
                    it['fill'] = fill
                items.append(it)
        storage = ref(si, 'ownedStorage')  # a shape with text inside it
        st = objs.get(storage) if storage else None
        if st and st.get('text') and ''.join(st['text']).strip():
            items += text_items(objs, si, storage, xf, w, h, valign, pad)
        return items
    if t == 'TSD.ImageArchive':
        return image_item(objs, o, parent_xf, media, warnings)
    if t == 'TSD.MovieArchive':
        warnings.add('movies (not converted yet)')
    else:
        warnings.add(f'{t} objects (not converted yet)')
    return []


def slide_builds(objs, slide):
    """{drawable id: {'in': step, 'out': step}} from the slide's build chunks, in presentation order."""
    steps, step = {}, 0
    for cref in slide.get('buildChunks', []):
        chunk = objs.get(str(cref['identifier']))
        if not chunk:
            continue
        build = objs.get(ref(chunk, 'build'))
        if not build:
            continue
        if not chunk.get('automatic') or step == 0:
            step += 1  # a click starts a new step; automatic chunks join the previous one
        did = ref(build, 'drawable')
        kind = build.get('attributes', {}).get('animationAttributes', {}).get('animationType', 'In')
        rec = steps.setdefault(did, {})
        if kind == 'Out':
            rec.setdefault('out', step)
        else:
            rec.setdefault('in', step)
    return steps


def convert(path, include_skipped=False):
    objs = read_archives(path)
    show = next((o for o in objs.values() if o.get('_pbtype') == 'KN.ShowArchive'), None)
    if not show:
        raise SystemExit(f'{path}: no presentation found in this file.')
    size = show.get('size', {'width': 1920, 'height': 1080})
    warnings = set()
    media = Media(path)
    slides = []
    for node_ref in show.get('slideTree', {}).get('slides', []):
        node = objs.get(str(node_ref['identifier']), {})
        if node.get('isSkipped') and not include_skipped:
            continue
        slide = objs.get(ref(node, 'slide'))
        if not slide:
            continue
        builds = slide_builds(objs, slide)
        items = []
        for z, dref in enumerate(slide.get('drawablesZOrder', [])):
            did = str(dref['identifier'])
            b = builds.get(did, {})
            for it in drawable_items(objs, did, Xf(), warnings, media):
                it['group'] = did
                it['in'] = b.get('in', 0)
                if 'out' in b:
                    it['out'] = b['out']
                items.append(it)
        title = next((i['text'] for i in items if i['type'] == 'text'), '')
        fill = style_prop(objs, ref(slide, 'style'), 'slideProperties', 'fill') or {}
        if fill.get('image') or fill.get('gradient'):
            warnings.add('background images and gradients (a plain colour is used)')
        entry = {'name': title[:60] or f'Slide {len(slides) + 1}', 'items': items}
        if fill.get('color'):
            entry['background'] = hex_color(fill['color'], '#ffffff')
        slides.append(entry)
    return {
        'format': FORMAT, 'version': 1, 'source': 'keynote',
        'name': os.path.splitext(os.path.basename(path))[0],
        'slide': {'width': size.get('width', 1920), 'height': size.get('height', 1080)},
        'slides': slides,
        'assets': media.assets,
        'warnings': sorted(warnings),
    }


def main():
    ap = argparse.ArgumentParser(description='Convert a Keynote file to a Stepboard import file.')
    ap.add_argument('keynote', help='the .key file (saved as a single file)')
    ap.add_argument('-o', '--output', help='output file (default: next to the input, .stepboard-import.json)')
    ap.add_argument('--include-skipped', action='store_true', help='also convert skipped slides')
    ap.add_argument('--verbose', action='store_true', help="show keynote-parser's warnings about unknown records")
    args = ap.parse_args()
    data = convert(args.keynote, args.include_skipped)
    out = args.output or os.path.splitext(args.keynote)[0] + '.stepboard-import.json'
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    strokes = sum(1 for s in data['slides'] for i in s['items'] if i['type'] == 'stroke')
    texts = sum(1 for s in data['slides'] for i in s['items'] if i['type'] == 'text')
    images = sum(1 for s in data['slides'] for i in s['items'] if i['type'] == 'image')
    steps = sum(max([i.get('out', 0) for i in s['items']] + [i['in'] for i in s['items']] + [0]) for s in data['slides'])
    print(f'{out}: {len(data["slides"])} slides, {strokes} strokes, {texts} text items, {images} images, {steps} build steps')
    for w in data['warnings']:
        print(f'  skipped: {w}')


if __name__ == '__main__':
    main()
