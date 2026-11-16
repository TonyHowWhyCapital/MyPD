// The bar between two blocks of the window. Dragging it gives one of the blocks a size of
// its own, the other one takes the rest; a double click gives the size back to the layout.
//
// Props
//   base    class prefix of the window
//   axis    'x': the blocks stand side by side, 'y': one above the other
//   side    'before' | 'after': the block that is sized, the one before or after the bar
//   min     least size of that block, in px
//   keep    least size left to the block on the other side, in px
//   onSize  (px | null) => void, called once when the drag ends; null on a double click
import React from 'react';

// -> the size kept between `min` and what leaves `keep` to the other block
export const clampSize = (size, min, room, keep) => Math.round(
  Math.max(min, Math.min(size, Math.max(min, room - keep))));

export default React.memo(({
  base, axis, side, min, keep, onSize,
}) => {
  const start = (e) => {
    e.preventDefault();
    const bar = e.currentTarget;
    const blocks = [bar.previousElementSibling, bar.nextElementSibling];
    const [block, other] = side === 'before' ? blocks : blocks.reverse();
    const prop = axis === 'x' ? 'width' : 'height';
    const from = block.getBoundingClientRect()[prop];
    const room = from + other.getBoundingClientRect()[prop];
    const origin = axis === 'x' ? e.clientX : e.clientY;
    let size = null;
    bar.classList.add(`${base}-splitter-active`);
    const move = (ev) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
      size = clampSize(from + (side === 'before' ? delta : -delta), min, room, keep);
      // the block follows the pointer at once; the window is drawn again when the drag ends
      block.style.flex = 'none';
      block.style[prop] = `${size}px`;
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      bar.classList.remove(`${base}-splitter-active`);
      size !== null && onSize(size);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };
  return <div
    className={`${base}-splitter ${base}-splitter-${axis}`}
    onMouseDown={start}
    onDoubleClick={() => onSize(null)}
  />;
});
