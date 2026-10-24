// Player runtime for exported HTML files: exposes window.StepboardPlayer.
import { present, assetsFromDeck } from './player.js'
window.StepboardPlayer = { present, assetsFromDeck }
