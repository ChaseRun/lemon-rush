import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SCENE } from './scene';
import { StartScreen } from './StartScreen';

describe('StartScreen', () => {
  const html = renderToStaticMarkup(<StartScreen onStart={() => {}} onRules={() => {}} />);

  it('renders the title and both buttons', () => {
    expect(html).toContain('id="st-title"');
    expect(html).toMatch(/>Lemon<\/span> <span[^>]*>Rush</);
    expect(html).toContain('>Start summer</button>');
    expect(html).toContain('>How to play</button>');
  });

  it('draws the pixel art as crisp SVG rects, with only the scene exposed to screen readers', () => {
    expect(html.match(/<svg/g)).toHaveLength(5);
    expect(html.match(/role="img"/g)).toHaveLength(1);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(4);
    expect(html).toContain('shape-rendering="crispEdges"');
    const sceneRects = SCENE.reduce((n, layer) => n + layer.rects.length, 0);
    expect((html.match(/<rect /g) ?? []).length).toBeGreaterThan(sceneRects);
  });
});
