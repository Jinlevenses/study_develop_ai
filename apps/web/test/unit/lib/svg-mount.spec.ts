import { describe, expect, it } from 'vitest';
import { mountSvg, sanitizeSvg } from '../../../src/lib/svg-mount.js';

const EVIL = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(1)</script>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  <style>.a { fill: red }</style>
  <g onclick="x()">
    <a href="javascript:alert(1)"><text>bad</text></a>
    <a xlink:href="http://evil.example/"><text>remote</text></a>
    <a href="#frag"><text>ok</text></a>
    <rect id="r" style="background:url(http://evil.example/x)" width="1" height="1"/>
    <rect id="s" style="fill: blue" width="1" height="1"/>
    <iframe src="x"></iframe><object data="x"></object><embed src="x"/><audio src="x"></audio><video src="x"></video>
  </g>
</svg>`;

describe('svg-mount', () => {
  it('UT-WEB-037 sanitizeSvg는 script·foreignObject·on*·위험 href·url() style을 제거하고 style 요소·#frag href는 유지하며 깨진 XML은 null이다 [NFR-SEC-009][FR-UX-014]', () => {
    const svg = sanitizeSvg(EVIL);
    expect(svg).not.toBeNull();
    if (svg === null) {
      return;
    }
    const names = [...svg.querySelectorAll('*')].map((e) => e.localName.toLowerCase());
    for (const bad of ['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video']) {
      expect(names, bad).not.toContain(bad);
    }
    expect(names).toContain('style');
    const all = [svg, ...svg.querySelectorAll('*')];
    for (const el of all) {
      for (const a of [...el.attributes]) {
        expect(a.name.toLowerCase().startsWith('on'), `${el.localName} ${a.name}`).toBe(false);
      }
    }
    const anchors = [...svg.querySelectorAll('a')];
    expect(anchors).toHaveLength(3);
    expect(anchors[0]?.getAttribute('href')).toBeNull();
    expect(anchors[1]?.getAttribute('xlink:href')).toBeNull();
    expect(anchors[2]?.getAttribute('href')).toBe('#frag');
    expect(svg.querySelector('#r')?.getAttribute('style')).toBeNull();
    expect(svg.querySelector('#s')?.getAttribute('style')).toBe('fill: blue');
    expect(svg.getAttribute('viewBox')).toBe('0 0 10 10');

    // SMIL로 href를 바꿔 치는 우회·<style>의 외부 url/@import
    const smil = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <style>@import url(http://evil.example/x.css); .a { fill: url(http://evil.example/f); stroke: url(#grad) } .b { fill: blue }</style>
      <a href="#ok"><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/><text>t</text></a>
      <animateMotion path="M0,0"/><animateTransform attributeName="transform"/>
    </svg>`);
    expect(smil).not.toBeNull();
    if (smil === null) {
      return;
    }
    const smilNames = [...smil.querySelectorAll('*')].map((e) => e.localName.toLowerCase());
    for (const bad of ['animate', 'set', 'animatemotion', 'animatetransform']) {
      expect(smilNames, bad).not.toContain(bad);
    }
    const styleText = smil.querySelector('style')?.textContent ?? '';
    expect(styleText).not.toMatch(/@import|evil\.example/);
    expect(styleText).toContain('url(#grad)');
    expect(styleText).toContain('.b { fill: blue }');
    expect(smil.innerHTML.toLowerCase()).not.toContain('javascript:');

    expect(sanitizeSvg('<svg><g></svg')).toBeNull();
    expect(sanitizeSvg('not xml at all')).toBeNull();
    expect(sanitizeSvg('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')).toBeNull();

    const host = document.createElement('div');
    host.append(document.createElement('span'));
    expect(mountSvg(host, EVIL)).toBe(true);
    expect(host.children).toHaveLength(1);
    expect(host.querySelector('script, foreignObject, iframe, object, embed')).toBeNull();
    expect(host.innerHTML.toLowerCase()).not.toContain('onload');
    expect(host.innerHTML.toLowerCase()).not.toContain('javascript:');
    const untouched = document.createElement('div');
    untouched.append(document.createElement('b'));
    expect(mountSvg(untouched, '<svg><g></svg')).toBe(false);
    expect(untouched.querySelector('b')).not.toBeNull();
  });
});
