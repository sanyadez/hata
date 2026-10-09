# Third-party code

The files in this folder are third-party works, distributed unmodified (only the `sourceMappingURL` line is
removed) under their own license. They are not covered by the license of the rest of this repository.
The page loads them only when a terminal is opened.

| File here | Package | Original |
|---|---|---|
| `xterm.js` | `@xterm/xterm` 6.0.0 | `lib/xterm.js` |
| `xterm.css` | `@xterm/xterm` 6.0.0 | `css/xterm.css` |
| `xterm-addon-fit.js` | `@xterm/addon-fit` 0.11.0 | `lib/addon-fit.js` |

Source: <https://github.com/xtermjs/xterm.js>. To update: `bun add @xterm/xterm @xterm/addon-fit` in a
temporary folder and copy the three files here.

## xterm.js — MIT License

Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
