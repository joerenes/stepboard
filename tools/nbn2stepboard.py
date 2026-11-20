#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
nbn2stepboard: convert a Notability note into a Stepboard import file.

    uv run tools/nbn2stepboard.py "Lecture 3.nbn"            # writes "Lecture 3.stepboard-import.json"
    uv run tools/nbn2stepboard.py "Lecture 3.zip"            # the .nbn folder compressed in Finder
    uv run tools/nbn2stepboard.py "Lecture 3.nbn" --builds lines --pages
    uv run tools/nbn2stepboard.py "Slides.nbn" --turned              # written with the iPad turned sideways
    python3 tools/nbn2stepboard.py ...                       # also works: only the standard library is used

A Notability note (.nbn, and the older .note) is a folder (or zip) holding Session.plist, a keyed archive
with the handwriting as packed arrays: per stroke the number of points, width, colour and pen style, and the
points themselves as cubic Bézier control points (1 + 3n per stroke) with a pressure value per on-curve point.

Slides
  A note is one long portrait page (or several). By default it is cut into 16:9 slides of the full page
  width, top to bottom; each cut is moved up into the nearest empty band between lines of writing, so no
  line of writing is split. With --pages each paper page becomes one slide instead (the whole page fits
  the slide, centred). Landscape notes (paper orientation set to landscape in Notability) get one slide per
  page by default; --landscape treats any note's paper as landscape, --bands forces 16:9 bands.
  --turned is for pages written with the iPad held sideways on portrait paper (writing running up the page):
  each page is turned upright and becomes one landscape slide (--turned ccw if the writing runs down).

Builds (--builds)
  none   everything is visible from the start (default)
  lines  strokes appear in the order they were written, a line (or other cluster of nearby strokes) at a time

What is converted: pen and pencil strokes (pencil pressure becomes tldraw pen pressure; the pencil's grainy
texture is not reproduced), highlighter strokes, colours (to the nearest tldraw colour; the exact colour is
kept on each shape), typed text (one text box per paragraph, positioned on the note's text lines).
Not converted (yet): images, PDF pages, shapes, audio recordings.

Open the result in Stepboard with "Open file", or add it to an open deck with "From file" under Slides.
"""
import argparse
import io
import json
import math
import os
import plistlib
import re
import struct
import sys
import zipfile

FORMAT = 'stepboard-import'
PAPER_INCHES = {'letter': (8.5, 11), 'a4': (210 / 25.4, 297 / 25.4), 'a5': (148 / 25.4, 210 / 25.4), 'legal': (8.5, 14)}
DEFAULT_WIDTH = 716.8          # Notability's page width in document units on the iPad
STYLE_PEN, STYLE_PENCIL = 3, 5
# Typed text sits on the note's text lines. Measured from a Notability PDF export: the first line's
# baseline is 15.45 units below the top, the text starts 19.1 units from the left edge, and lines are one
# dot-grid spacing apart (5 mm on the default paper).
TEXT_LEFT, TEXT_FIRST_BASELINE, TEXT_ASCENT = 19.1, 15.45, 0.95


# ---------------------------------------------------------------- reading the note

def read_session(path):
    """Session.plist of a .nbn/.note folder, or of a zip holding one."""
    if os.path.isdir(path):
        for root, _dirs, files in os.walk(path):
            if 'Session.plist' in files:
                with open(os.path.join(root, 'Session.plist'), 'rb') as f:
                    return f.read()
        sys.exit(f'{path}: no Session.plist inside; is this a Notability note?')
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.endswith('Session.plist') and '__MACOSX' not in n]
            if not names:
                sys.exit(f'{path}: no Session.plist inside; is this a zipped Notability note?')
            return z.read(sorted(names, key=len)[0])
    sys.exit(f'{path}: expected a .nbn/.note folder or a zip of one')


class Archive:
    """Minimal reader for NSKeyedArchiver plists: follows UIDs, unwraps arrays, dicts and strings."""

    def __init__(self, data):
        self.plist = plistlib.load(io.BytesIO(data))
        self.objs = self.plist['$objects']

    def get(self, v):
        while isinstance(v, plistlib.UID):
            v = self.objs[v.data]
        return v

    def value(self, v):
        v = self.get(v)
        if isinstance(v, dict):
            if 'NS.objects' in v and 'NS.keys' in v:
                return {self.value(k): self.value(o) for k, o in zip(v['NS.keys'], v['NS.objects'])}
            if 'NS.objects' in v:
                return [self.value(o) for o in v['NS.objects']]
            if 'NS.bytes' in v:
                return v['NS.bytes'].decode('utf-8', 'replace')
            if 'NS.string' in v:
                return v['NS.string']
        return v

    def find(self, key):
        """All archived objects that have `key`."""
        return [o for o in self.objs if isinstance(o, dict) and key in o]


def unpack(fmt, data, count):
    size = struct.calcsize('<' + fmt)
    count = min(count, len(data) // size)
    return list(struct.unpack(f'<{count}{fmt}', data[:count * size]))


def read_curves(arc, warnings):
    """Strokes in writing order: [{points: [(x, y)...] control points, width, rgba, style, forces}]."""
    curves = []
    for h in arc.find('curvespoints'):
        nums = unpack('i', h.get('curvesnumpoints', b''), 1 << 30)
        n = len(nums)
        widths = unpack('f', h.get('curveswidth', b''), n)
        colors = h.get('curvescolors', b'')
        styles = list(h.get('curvesstyles', b''))
        pts = unpack('f', h['curvespoints'], 2 * sum(nums))
        forces = unpack('f', h.get('curvesforces', b''), 1 << 30)
        on_total = sum((c - 1) // 3 + 1 for c in nums)
        if len(forces) != on_total:
            forces = []
        p = f = 0
        for i, c in enumerate(nums):
            on = (c - 1) // 3 + 1
            xy = [(pts[2 * j], pts[2 * j + 1]) for j in range(p, p + c)]
            curves.append({
                'points': xy,
                'width': widths[i] if i < len(widths) else 2.0,
                'rgba': tuple(colors[4 * i:4 * i + 4]) if len(colors) >= 4 * i + 4 else (0, 0, 0, 255),
                'style': styles[i] if i < len(styles) else STYLE_PEN,
                'forces': forces[f:f + on] if forces else None,
            })
            p += c
            f += on
    return curves


def bezier_polyline(ctrl, forces):
    """Sample a chain of cubic Bézier segments (1 + 3n control points). Returns [(x, y, pressure|None)]."""
    if len(ctrl) < 4 or (len(ctrl) - 1) % 3:
        return [(x, y, None) for x, y in ctrl]
    out = []
    for s in range(0, len(ctrl) - 1, 3):
        p0, c1, c2, p3 = ctrl[s:s + 4]
        f0 = forces[s // 3] if forces and s // 3 < len(forces) else None
        f1 = forces[s // 3 + 1] if forces and s // 3 + 1 < len(forces) else f0
        length = math.dist(p0, c1) + math.dist(c1, c2) + math.dist(c2, p3)
        steps = max(1, min(16, math.ceil(length / 2.5)))
        for k in range(0 if s == 0 else 1, steps + 1):
            t = k / steps
            u = 1 - t
            x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0]
            y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]
            out.append((x, y, None if f0 is None else f0 + (f1 - f0) * t))
    return out


def read_text(arc):
    """Typed text: [(line_index, paragraph, colour, font size)], from the note's main attributed string."""
    out = []
    for obj in arc.find('attributedString'):
        d = arc.value(obj['attributedString'])
        if not isinstance(d, dict):
            continue
        text = d.get('stringKey') or ''
        ranges = []
        for r in d.get('subRangesKey') or []:
            m = re.match(r'\{(\d+),\s*(\d+)\}', str(r.get('subRangeRangeKey', '')))
            if not m:
                continue
            start, length = int(m.group(1)), int(m.group(2))
            rgba = [float(v) for v in str(r.get('subRangeColorCrossPlatformKey', '0,0,0,1')).split(',')[:4]]
            size = (r.get('subRangeFontKey') or {}).get('NSFontSizeAttribute', 12.0)
            ranges.append((start, start + length, rgba, float(size)))
        pos = 0
        for i, para in enumerate(text.split('\n')):
            if para.strip():
                r = next((r for r in ranges if r[0] <= pos < r[1]), (0, 0, [0, 0, 0, 1], 12.0))
                out.append((i, para, r[2], r[3]))
            pos += len(para) + 1
    return out


def paper(arc, landscape=None):
    """(page width, page height, text line spacing, landscape) in document units. `landscape` overrides the
    note's own paper orientation (True / False); None uses the note's."""
    width, inches, spacing, orient = DEFAULT_WIDTH, PAPER_INCHES['letter'], None, 'portrait'
    for o in arc.find('paperSize'):
        inches = PAPER_INCHES.get(str(arc.get(o.get('paperSize'))).lower(), inches)
        orient = str(arc.get(o.get('paperOrientation')) or orient).lower()
        style = str(arc.get(o.get('lineStyle2')) or '')
        m = re.search(r':([\d.]+)$', style)
        if m:  # line or dot spacing in inches
            spacing = float(m.group(1))
        m = re.search(r'lockedWidth:([\d.]+)', str(arc.get(o.get('paperSizingBehavior')) or ''))
        if m:
            width = float(m.group(1))
    for o in arc.find('pageWidthInDocumentCoordsKey'):
        width = float(o['pageWidthInDocumentCoordsKey']) or width
    if landscape is None:
        landscape = orient.startswith('landscape')
    across, down = (inches[1], inches[0]) if landscape else inches
    units_per_inch = width / across
    return width, down * units_per_inch, (spacing * units_per_inch if spacing else 16.6), landscape


# ---------------------------------------------------------------- turning it into slides

def hex_rgb(rgba):
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in rgba[:3])


def bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def cut_bands(boxes, page_w, total_h):
    """Top edges of 16:9 slides covering [0, total_h]; each cut moved up into a gap between lines."""
    band = page_w * 9 / 16
    tops, top = [], 0.0
    while top < total_h:
        tops.append(top)
        target = top + band
        if target >= total_h:
            break
        # Rows covered by some stroke; find the lowest uncovered y in the lower 40% of the slide.
        best = None
        y = target
        while y > top + band * 0.6:
            if not any(b[1] < y < b[3] for b in boxes):
                best = y
                break
            y -= 1.0
        if best is None:  # no gap: cut where the fewest strokes cross
            best = min((top + band * (0.6 + 0.4 * i / 40) for i in range(41)),
                       key=lambda y: (sum(1 for b in boxes if b[1] < y < b[3]), -y))
        top = best
    return tops, band


def group_builds(items):
    """Step numbers for items in writing order: a new step when a stroke is away from the current cluster."""
    steps, cur, step = [], None, 0
    for it in items:
        b = it['_box']
        if cur is None:
            step, cur = 1, list(b)
        else:
            h = max(8.0, cur[3] - cur[1])
            near = b[0] < cur[2] + 3 * h and b[2] > cur[0] - 3 * h and b[1] < cur[3] + 0.35 * h and b[3] > cur[1] - 0.35 * h
            if near:
                cur = [min(cur[0], b[0]), min(cur[1], b[1]), max(cur[2], b[2]), max(cur[3], b[3])]
            else:
                step, cur = step + 1, list(b)
        steps.append(step)
    return steps


def turn_pages(items, page_w, page_h, direction, warnings):
    """Pages written with the iPad turned sideways: rotate each page a quarter turn (cw: clockwise) so the
    writing reads normally, and stack the now-landscape pages again. Returns the new page width and height."""
    def page_of(it):
        return int(((it['_box'][1] + it['_box'][3]) / 2) // page_h)

    def move(x, y, p):
        y -= p * page_h
        return ((page_h - y, x + p * page_w) if direction == 'cw' else (y, page_w - x + p * page_w))

    for it in items:
        p = page_of(it)
        if it['type'] == 'stroke':
            it['points'] = [(*move(x, y, p), f) for x, y, f in it['points']]
            it['_box'] = bbox(it['points'])
            w = it['width']
            it['_ink'] = [v + d for v, d in zip(it['_box'], (-w, -w, w, w))]
        else:
            warnings.add('the direction of typed text on turned pages (it stays horizontal)')
            it['x'], it['y'] = move(it['x'], it['y'], p)
            it['_box'] = it['_ink'] = [it['x'], it['y'], it['x'] + 0.5 * it['fontSize'] * len(it['text']), it['y'] + 1.2 * it['fontSize']]
    return page_h, page_w


def convert(path, builds='none', pages=None, landscape=None, turned=None):
    arc = Archive(read_session(path))
    warnings = set()
    page_w, page_h, line, landscape = paper(arc, landscape)
    if pages is None:  # landscape pages are usually slides already: one slide per page
        pages = landscape or bool(turned)

    items = []
    for c in read_curves(arc, warnings):
        r, g, b, a = (c['rgba'] + (255,) * 4)[:4]
        highlight = a < 255 or c['style'] not in (STYLE_PEN, STYLE_PENCIL)
        pts = bezier_polyline(c['points'], c['forces'] if c['style'] == STYLE_PENCIL else None)
        if not pts:
            continue
        it = {'type': 'stroke', 'color': hex_rgb((r, g, b)), 'width': round(c['width'], 3), 'points': pts}
        if highlight:
            it['highlight'] = True
            if c['style'] not in (STYLE_PEN, STYLE_PENCIL) and a == 255:
                warnings.add(f'pen style {c["style"]} (drawn as highlighter)')
        if c['style'] == STYLE_PENCIL:
            it['brush'] = 'pencil'
        w = c['width']  # the ink reaches beyond the centre line
        it['_box'] = bbox(pts)
        it['_ink'] = [v + d for v, d in zip(it['_box'], (-w, -w, w, w))]
        items.append(it)

    for i, para, rgba, size in read_text(arc):
        baseline = TEXT_FIRST_BASELINE + i * line
        y = baseline - TEXT_ASCENT * size
        it = {'type': 'text', 'x': TEXT_LEFT, 'y': y, 'w': page_w - 2 * TEXT_LEFT, 'text': para,
              'fontSize': size, 'color': hex_rgb([v * 255 for v in rgba])}
        it['_box'] = it['_ink'] = [TEXT_LEFT, y, TEXT_LEFT + 0.5 * size * len(para), y + 1.2 * size]
        items.append(it)

    if turned:
        page_w, page_h = turn_pages(items, page_w, page_h, turned, warnings)

    for key in ('mediaObjects', 'pdfFiles'):
        for o in arc.find(key):
            if arc.value(o[key]):
                warnings.add('images and PDF pages' if key == 'mediaObjects' else 'PDF pages')

    # Steps in writing order. Typed text has no time order; it is there from the start.
    if builds == 'lines':
        strokes = [it for it in items if it['type'] == 'stroke']
        for it, s in zip(strokes, group_builds(strokes)):
            it['in'] = s
        for it in items:
            it.setdefault('in', 0)

    # Slides.
    if not items:
        return {'format': FORMAT, 'version': 1, 'source': 'notability', 'name': note_name(path),
                'slide': {'width': page_w, 'height': page_w * 9 / 16}, 'slides': [], 'assets': {},
                'warnings': sorted(warnings)}
    total_h = max(it['_ink'][3] for it in items)
    slides = []
    if pages:
        # The page fits into the 16:9 slide: a portrait page or a landscape letter/A4 page fits its height
        # (centred, with space at the sides); a page wider than 16:9 fits its width.
        slide_h = page_w * 9 / 16
        k = min(1.0, slide_h / page_h)
        dx = (page_w - page_w * k) / 2
        dy = (slide_h - page_h * k) / 2
        for p in range(int(total_h // page_h) + 1):
            mine = [it for it in items if p * page_h <= (it['_box'][1] + it['_box'][3]) / 2 < (p + 1) * page_h]
            if mine:
                slides.append(place(mine, p * page_h - dy / k, k, dx, f'Page {p + 1}'))
    else:
        tops, band = cut_bands([it['_ink'] for it in items], page_w, total_h)
        tops.append(math.inf)
        for s in range(len(tops) - 1):
            mine = [it for it in items if tops[s] <= (it['_box'][1] + it['_box'][3]) / 2 < tops[s + 1]]
            if mine:
                # Lines written close together leave no gap to cut in: then the slide starts a little higher,
                # at its topmost stroke, so nothing sticks out above it.
                top = min(tops[s], min(it['_ink'][1] for it in mine) - 4)
                slides.append(place(mine, max(0.0, top), 1.0, 0.0, f'Part {len(slides) + 1}'))
    for s in slides:  # renumber steps per slide so each slide starts at 1
        used = sorted({it.get('in', 0) for it in s['items']})
        remap = {v: i + (0 if used[0] == 0 else 1) for i, v in enumerate(used)}
        for it in s['items']:
            if 'in' in it:
                it['in'] = remap[it['in']]
    return {
        'format': FORMAT, 'version': 1, 'source': 'notability', 'name': note_name(path),
        'slide': {'width': page_w, 'height': page_w * 9 / 16},
        'slides': slides, 'assets': {}, 'warnings': sorted(warnings),
    }


def place(items, top, k, dx, name):
    """Items moved into slide coordinates: shifted up by `top`, scaled by k (about the top-left), shifted by dx."""
    out = []
    for it in items:
        it = {key: v for key, v in it.items() if not key.startswith('_')}
        if it['type'] == 'stroke':
            pts = [(dx + x * k, (y - top) * k, f) for x, y, f in it['points']]
            it['points'] = [[round(x, 2), round(y, 2)] for x, y, _ in pts]
            if any(f is not None for *_, f in pts):
                # tldraw pen pressure 0..1; Notability's pencil force is about 0..3 (matched by eye to its PDF export).
                it['pressure'] = [round(min(1.0, max(0.05, 0.15 + (f or 0) / 4)), 2) for *_, f in pts]
            it['width'] = round(it['width'] * k, 3)
        else:
            it['x'], it['y'] = dx + it['x'] * k, (it['y'] - top) * k
            it['w'], it['fontSize'] = it['w'] * k, it['fontSize'] * k
        out.append(it)
    return {'name': name, 'items': out}


def note_name(path):
    base = os.path.basename(os.path.normpath(path))
    return re.sub(r'\.(nbn|note|zip)$', '', base, flags=re.I)


def main():
    ap = argparse.ArgumentParser(description='Convert a Notability note to a Stepboard import file.')
    ap.add_argument('note', help='the .nbn (or .note) folder, or a zip of it')
    ap.add_argument('-o', '--output', help='output file (default: next to the input, .stepboard-import.json)')
    ap.add_argument('--builds', choices=['none', 'lines'], default='none',
                    help='none: all visible (default); lines: strokes appear in writing order, a line at a time')
    ap.add_argument('--pages', action='store_true', default=None,
                    help='one slide per paper page instead of 16:9 bands (the default for landscape notes)')
    ap.add_argument('--bands', dest='pages', action='store_false', help='16:9 bands even for a landscape note')
    ap.add_argument('--turned', nargs='?', const='cw', choices=['cw', 'ccw'],
                    help='pages written with the iPad turned sideways: each page is turned a quarter turn, clockwise '
                         '(cw, the default: writing that runs up the page) or counter-clockwise (ccw: writing that '
                         'runs down the page), and becomes one landscape slide')
    ap.add_argument('--landscape', action='store_true', default=None,
                    help="treat the paper as landscape (not turned), whatever the note's setting says; implies --pages")
    args = ap.parse_args()
    data = convert(args.note, args.builds, args.pages, args.landscape, args.turned)
    out = args.output or os.path.join(os.path.dirname(os.path.abspath(os.path.normpath(args.note))),
                                      note_name(args.note) + '.stepboard-import.json')
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    strokes = sum(1 for s in data['slides'] for i in s['items'] if i['type'] == 'stroke')
    texts = sum(1 for s in data['slides'] for i in s['items'] if i['type'] == 'text')
    steps = sum(max([i.get('in', 0) for i in s['items']] + [0]) for s in data['slides'])
    print(f'{out}: {len(data["slides"])} slides, {strokes} strokes, {texts} text items, {steps} build steps')
    for w in data['warnings']:
        print(f'  not converted: {w}')


if __name__ == '__main__':
    main()
