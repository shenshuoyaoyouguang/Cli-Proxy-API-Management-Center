const VERTICAL_TRANSITION_DURATION = 0.35;
const VERTICAL_TRAVEL_DISTANCE = 60;
const IOS_TRANSITION_DURATION = 0.42;
const IOS_ENTER_FROM_X_PERCENT = 100;
const IOS_EXIT_TO_X_PERCENT_FORWARD = -30;
const IOS_EXIT_TO_X_PERCENT_BACKWARD = 100;
const IOS_ENTER_FROM_X_PERCENT_BACKWARD = -30;
const IOS_EXIT_DIM_OPACITY = 0.72;
const IOS_SHADOW_VALUE = '-14px 0 24px rgba(0, 0, 0, 0.16)';

export const TRANSITION_CONSTANTS = {
  VERTICAL_TRANSITION_DURATION,
  VERTICAL_TRAVEL_DISTANCE,
  IOS_TRANSITION_DURATION,
  IOS_ENTER_FROM_X_PERCENT,
  IOS_EXIT_TO_X_PERCENT_FORWARD,
  IOS_EXIT_TO_X_PERCENT_BACKWARD,
  IOS_ENTER_FROM_X_PERCENT_BACKWARD,
  IOS_EXIT_DIM_OPACITY,
  IOS_SHADOW_VALUE,
} as const;

export const easePower2Out = (progress: number) => 1 - (1 - progress) ** 3;
export const easeCircOut = (progress: number) => Math.sqrt(1 - (progress - 1) ** 2);

export const buildVerticalTransform = (y: number) => `translate3d(0px, ${y}px, 0px)`;
export const buildIosTransform = (xPercent: number, y: number) => `translate3d(${xPercent}%, ${y}px, 0px)`;

export const clearLayerStyles = (element: HTMLElement | null) => {
  if (!element) return;
  element.style.removeProperty('transform');
  element.style.removeProperty('opacity');
  element.style.removeProperty('box-shadow');
};
