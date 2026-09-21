export const isFocusWithinAiMenu = (
  relatedTarget: EventTarget | null,
  container: HTMLElement | null,
) =>
  relatedTarget instanceof Node && container?.contains(relatedTarget) === true;
