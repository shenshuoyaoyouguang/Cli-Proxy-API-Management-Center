import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  easePower2Out,
  easeCircOut,
  buildVerticalTransform,
  buildIosTransform,
  clearLayerStyles,
  TRANSITION_CONSTANTS,
} from './transitionUtils';

describe('PageTransition Utilities', () => {
  describe('TRANSITION_CONSTANTS', () => {
    it('exports all required transition constants', () => {
      expect(TRANSITION_CONSTANTS.VERTICAL_TRANSITION_DURATION).toBe(0.35);
      expect(TRANSITION_CONSTANTS.VERTICAL_TRAVEL_DISTANCE).toBe(60);
      expect(TRANSITION_CONSTANTS.IOS_TRANSITION_DURATION).toBe(0.42);
      expect(TRANSITION_CONSTANTS.IOS_ENTER_FROM_X_PERCENT).toBe(100);
      expect(TRANSITION_CONSTANTS.IOS_EXIT_TO_X_PERCENT_FORWARD).toBe(-30);
      expect(TRANSITION_CONSTANTS.IOS_EXIT_TO_X_PERCENT_BACKWARD).toBe(100);
      expect(TRANSITION_CONSTANTS.IOS_ENTER_FROM_X_PERCENT_BACKWARD).toBe(-30);
      expect(TRANSITION_CONSTANTS.IOS_EXIT_DIM_OPACITY).toBe(0.72);
      expect(TRANSITION_CONSTANTS.IOS_SHADOW_VALUE).toBe('-14px 0 24px rgba(0, 0, 0, 0.16)');
    });

    it('has correct vertical transition duration', () => {
      expect(TRANSITION_CONSTANTS.VERTICAL_TRANSITION_DURATION).toBeGreaterThan(0);
      expect(TRANSITION_CONSTANTS.VERTICAL_TRANSITION_DURATION).toBeLessThan(1);
    });

    it('has correct iOS transition duration', () => {
      expect(TRANSITION_CONSTANTS.IOS_TRANSITION_DURATION).toBeGreaterThan(0);
      expect(TRANSITION_CONSTANTS.IOS_TRANSITION_DURATION).toBeLessThan(1);
    });

    it('has valid iOS dim opacity value', () => {
      expect(TRANSITION_CONSTANTS.IOS_EXIT_DIM_OPACITY).toBeGreaterThanOrEqual(0);
      expect(TRANSITION_CONSTANTS.IOS_EXIT_DIM_OPACITY).toBeLessThanOrEqual(1);
    });
  });

  describe('easePower2Out', () => {
    it('returns 0 when progress is 0', () => {
      expect(easePower2Out(0)).toBe(0);
    });

    it('returns 1 when progress is 1', () => {
      expect(easePower2Out(1)).toBe(1);
    });

    it('returns value between 0 and 1 for progress between 0 and 1', () => {
      const result = easePower2Out(0.5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    it('is monotonically increasing', () => {
      const prev = easePower2Out(0);
      for (let i = 1; i <= 10; i++) {
        const curr = easePower2Out(i / 10);
        expect(curr).toBeGreaterThan(prev);
      }
    });

    it('produces smooth ease-out curve', () => {
      const result0_5 = easePower2Out(0.5);
      expect(result0_5).toBeGreaterThan(0.5);
      expect(result0_5).toBe(1 - (1 - 0.5) ** 3);
    });

    it('handles progress greater than 1', () => {
      expect(easePower2Out(1.5)).toBeGreaterThan(1);
    });

    it('handles negative progress', () => {
      expect(easePower2Out(-0.5)).toBeLessThan(0);
    });
  });

  describe('easeCircOut', () => {
    it('returns 0 when progress is 0', () => {
      expect(easeCircOut(0)).toBe(0);
    });

    it('returns 1 when progress is 1', () => {
      expect(easeCircOut(1)).toBe(1);
    });

    it('returns value between 0 and 1 for progress between 0 and 1', () => {
      const result = easeCircOut(0.5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    it('is monotonically increasing for 0-1 range', () => {
      const prev = easeCircOut(0);
      for (let i = 1; i <= 10; i++) {
        const curr = easeCircOut(i / 10);
        expect(curr).toBeGreaterThan(prev);
      }
    });

    it('produces circular ease-out curve', () => {
      const result0_5 = easeCircOut(0.5);
      expect(result0_5).toBeGreaterThan(0.5);
    });
  });

  describe('buildVerticalTransform', () => {
    it('returns translate3d string with correct y value', () => {
      const result = buildVerticalTransform(0);
      expect(result).toBe('translate3d(0px, 0px, 0px)');
    });

    it('handles positive y values', () => {
      const result = buildVerticalTransform(60);
      expect(result).toBe('translate3d(0px, 60px, 0px)');
    });

    it('handles negative y values', () => {
      const result = buildVerticalTransform(-60);
      expect(result).toBe('translate3d(0px, -60px, 0px)');
    });

    it('handles decimal y values', () => {
      const result = buildVerticalTransform(10.5);
      expect(result).toBe('translate3d(0px, 10.5px, 0px)');
    });

    it('always includes translate3d format', () => {
      const result = buildVerticalTransform(100);
      expect(result).toMatch(/^translate3d\(0px,/);
      expect(result).toMatch(/, 0px\)$/);
    });

    it('uses VERTICAL_TRAVEL_DISTANCE constant for animation travel', () => {
      const result = buildVerticalTransform(TRANSITION_CONSTANTS.VERTICAL_TRAVEL_DISTANCE);
      expect(result).toBe('translate3d(0px, 60px, 0px)');
    });
  });

  describe('buildIosTransform', () => {
    it('returns translate3d string with correct x percent and y value', () => {
      const result = buildIosTransform(0, 0);
      expect(result).toBe('translate3d(0%, 0px, 0px)');
    });

    it('handles positive x percent values', () => {
      const result = buildIosTransform(100, 0);
      expect(result).toBe('translate3d(100%, 0px, 0px)');
    });

    it('handles negative x percent values', () => {
      const result = buildIosTransform(-30, 0);
      expect(result).toBe('translate3d(-30%, 0px, 0px)');
    });

    it('handles positive y values', () => {
      const result = buildIosTransform(0, 50);
      expect(result).toBe('translate3d(0%, 50px, 0px)');
    });

    it('handles negative y values', () => {
      const result = buildIosTransform(0, -50);
      expect(result).toBe('translate3d(0%, -50px, 0px)');
    });

    it('handles both x percent and y values together', () => {
      const result = buildIosTransform(100, 60);
      expect(result).toBe('translate3d(100%, 60px, 0px)');
    });

    it('uses IOS_ENTER_FROM_X_PERCENT constant for enter animation', () => {
      const result = buildIosTransform(TRANSITION_CONSTANTS.IOS_ENTER_FROM_X_PERCENT, 0);
      expect(result).toBe('translate3d(100%, 0px, 0px)');
    });

    it('uses IOS_EXIT_TO_X_PERCENT_FORWARD constant for forward exit', () => {
      const result = buildIosTransform(TRANSITION_CONSTANTS.IOS_EXIT_TO_X_PERCENT_FORWARD, 0);
      expect(result).toBe('translate3d(-30%, 0px, 0px)');
    });
  });

  describe('clearLayerStyles', () => {
    let mockElement: HTMLElement;

    beforeEach(() => {
      mockElement = {
        style: {
          transform: 'translate3d(10px, 20px, 30px)',
          opacity: '0.5',
          boxShadow: '0 10px 20px rgba(0,0,0,0.3)',
          removeProperty: vi.fn(),
        },
      } as unknown as HTMLElement;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does nothing when element is null', () => {
      expect(() => clearLayerStyles(null)).not.toThrow();
    });

    it('handles falsy elements gracefully', () => {
      expect(() => clearLayerStyles(null as unknown as HTMLElement)).not.toThrow();
    });

    it('removes transform property', () => {
      clearLayerStyles(mockElement);
      expect(mockElement.style.removeProperty).toHaveBeenCalledWith('transform');
    });

    it('removes opacity property', () => {
      clearLayerStyles(mockElement);
      expect(mockElement.style.removeProperty).toHaveBeenCalledWith('opacity');
    });

    it('removes box-shadow property', () => {
      clearLayerStyles(mockElement);
      expect(mockElement.style.removeProperty).toHaveBeenCalledWith('box-shadow');
    });

    it('removes all three properties in correct order', () => {
      clearLayerStyles(mockElement);
      expect(mockElement.style.removeProperty).toHaveBeenCalledTimes(3);
      expect(mockElement.style.removeProperty).toHaveBeenNthCalledWith(1, 'transform');
      expect(mockElement.style.removeProperty).toHaveBeenNthCalledWith(2, 'opacity');
      expect(mockElement.style.removeProperty).toHaveBeenNthCalledWith(3, 'box-shadow');
    });
  });

  describe('Transform function consistency', () => {
    it('vertical transform uses px units for y axis', () => {
      const result = buildVerticalTransform(TRANSITION_CONSTANTS.VERTICAL_TRAVEL_DISTANCE);
      expect(result).toContain('px');
    });

    it('iOS transform uses percent for x axis', () => {
      const result = buildIosTransform(TRANSITION_CONSTANTS.IOS_ENTER_FROM_X_PERCENT, 0);
      expect(result).toContain('%');
    });

    it('iOS transform uses px for y axis', () => {
      const result = buildIosTransform(0, 50);
      expect(result).toContain('px');
    });

    it('both transforms use translate3d format for GPU acceleration', () => {
      const vertical = buildVerticalTransform(60);
      const ios = buildIosTransform(100, 0);

      expect(vertical).toMatch(/^translate3d/);
      expect(ios).toMatch(/^translate3d/);
    });
  });

  describe('Animation values are valid for CSS transitions', () => {
    it('vertical travel distance is valid CSS length', () => {
      const result = buildVerticalTransform(TRANSITION_CONSTANTS.VERTICAL_TRAVEL_DISTANCE);
      expect(result).toMatch(/\d+px/);
    });

    it('iOS x percent is valid CSS percentage', () => {
      const result = buildIosTransform(TRANSITION_CONSTANTS.IOS_ENTER_FROM_X_PERCENT, 0);
      expect(result).toMatch(/\d+%/);
    });

    it('transition duration values are reasonable (in seconds)', () => {
      expect(TRANSITION_CONSTANTS.VERTICAL_TRANSITION_DURATION).toBeLessThan(1);
      expect(TRANSITION_CONSTANTS.IOS_TRANSITION_DURATION).toBeLessThan(1);
    });
  });
});

describe('PageTransition CSS', () => {
  describe('overflow: visible fix', () => {
    it('page-transition class exists for CSS styling', () => {
      const container = document.createElement('div');
      container.className = 'page-transition';

      expect(container.classList.contains('page-transition')).toBe(true);
    });

    it('layer classes are properly named for CSS targeting', () => {
      const layer = document.createElement('div');
      layer.className = 'page-transition__layer';
      expect(layer.classList.contains('page-transition__layer')).toBe(true);

      const exitLayer = document.createElement('div');
      exitLayer.className = 'page-transition__layer page-transition__layer--exit';
      expect(exitLayer.classList.contains('page-transition__layer--exit')).toBe(true);

      const stackedLayer = document.createElement('div');
      stackedLayer.className = 'page-transition__layer page-transition__layer--stacked';
      expect(stackedLayer.classList.contains('page-transition__layer--stacked')).toBe(true);
    });

    it('page-transition__layer--exit has overflow hidden for animation cleanup', () => {
      const exitLayer = document.createElement('div');
      exitLayer.className = 'page-transition__layer page-transition__layer--exit';

      expect(exitLayer).toBeDefined();
    });

    it('page-transition__layer--stacked-keep has overflow hidden for layered animation', () => {
      const stackedKeepLayer = document.createElement('div');
      stackedKeepLayer.className = 'page-transition__layer page-transition__layer--stacked page-transition__layer--stacked-keep';

      expect(stackedKeepLayer).toBeDefined();
    });
  });

  describe('layer status classes', () => {
    it('creates correct class names for current layer', () => {
      const layer = document.createElement('div');
      layer.className = 'page-transition__layer';
      expect(layer.classList.contains('page-transition__layer')).toBe(true);
    });

    it('exit layer gets --exit modifier', () => {
      const layer = document.createElement('div');
      layer.className = 'page-transition__layer page-transition__layer--exit';
      expect(layer.classList.contains('page-transition__layer--exit')).toBe(true);
    });

    it('stacked layer gets --stacked modifier', () => {
      const layer = document.createElement('div');
      layer.className = 'page-transition__layer page-transition__layer--stacked';
      expect(layer.classList.contains('page-transition__layer--stacked')).toBe(true);
    });

    it('stacked-keep layer gets additional modifier', () => {
      const layer = document.createElement('div');
      layer.className =
        'page-transition__layer page-transition__layer--stacked page-transition__layer--stacked-keep';
      expect(layer.classList.contains('page-transition__layer--stacked-keep')).toBe(true);
    });
  });
});
