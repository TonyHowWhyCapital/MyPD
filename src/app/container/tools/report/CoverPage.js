import React, { useRef, useState } from 'react';
import { coverStyle, logoStyle } from '../../../../lib/report/html';

const PX_PER_MM = 96 / 25.4;

// The cover as an A4 page drawn in millimetres and points, then scaled to `width` pixels,
// so every part sits and measures as it will in Word and in the browser. With `onMove` the
// parts can be dragged; the new place is reported once, when the mouse is let go.
export default ({
  cls, cover, landscape, width, selected, placeholder, onSelect, onMove,
}) => {
  const page = useRef(null);
  const [live, setLive] = useState(null);
  const [w, h] = landscape ? [297, 210] : [210, 297];
  const scale = width / (w * PX_PER_MM);
  const placed = part => (live && live.key === part.key ? { ...part, x: live.x, y: live.y } : part);
  const drag = (e, part) => {
    if (!onMove) return;
    e.preventDefault();
    onSelect && onSelect(part.key);
    const rect = page.current.getBoundingClientRect();
    const [x0, y0] = [e.clientX, e.clientY];
    const at = ev => ({
      key: part.key,
      x: Math.min(Math.max(part.x + ((ev.clientX - x0) / rect.width) * 100, 2), 98),
      y: Math.min(Math.max(part.y + ((ev.clientY - y0) / rect.height) * 100, 0), 97),
    });
    let last = null;
    const move = (ev) => {
      last = at(ev);
      setLive(last);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setLive(null);
      last && onMove(last.key, last.x, last.y);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const classOf = (part, extra = '') => [
    onMove ? 'movable' : '', selected === part.key ? 'picked' : '', extra,
  ].filter(Boolean).join(' ');
  const logo = cover.logo && placed(cover.logo);
  return <div className={`${cls}-page`} style={{ width, height: (width * h) / w }}>
    <div
      ref={page}
      className={`${cls}-sheet`}
      style={{
        width: `${w}mm`,
        height: `${h}mm`,
        transform: `scale(${scale})`,
        backgroundImage: cover.background ? `url(${cover.background.data})` : undefined,
      }}
    >
      {logo && <img
        alt=''
        draggable={false}
        src={logo.data}
        className={classOf(logo)}
        style={logoStyle(logo)}
        onMouseDown={e => drag(e, logo)}
      />}
      {cover.texts.map((t) => {
        const part = placed(t);
        return <div
          key={part.key}
          className={classOf(part, part.text ? '' : 'empty')}
          style={coverStyle(part)}
          onMouseDown={e => drag(e, part)}
        >{part.text || (placeholder && placeholder(part.key))}</div>;
      })}
    </div>
  </div>;
};
