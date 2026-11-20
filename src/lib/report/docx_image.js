import { extensionOf, cropToFill } from './image';

// English Metric Units: 635 to a twentieth of a point.
const EMU = 635;
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const DRAWING_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

export const mediaName = (name, image) => `media/${name}.${extensionOf(image)}`;

const graphic = (id, name, size, crop = { x: 0, y: 0 }) => {
  const cut = v => Math.round(v * 100000);
  const src = crop.x || crop.y ? `<a:srcRect l="${cut(crop.x)}" t="${cut(crop.y)}" r="${cut(crop.x)}" b="${cut(crop.y)}"/>` : '';
  return `<a:graphic><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${name}"/>${src}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size.width}" cy="${size.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
};

// Floating at its place on the page, `box` in twentieths of a point.
export const logoAnchor = (image, box) => {
  const width = box.width * EMU;
  const size = { width, height: Math.round((width * image.height) / image.width) };
  const offset = v => `<wp:posOffset>${v * EMU}</wp:posOffset>`;
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page">${offset(box.left)}</wp:positionH><wp:positionV relativeFrom="page">${offset(box.top)}</wp:positionV><wp:extent cx="${size.width}" cy="${size.height}"/><wp:wrapNone/><wp:docPr id="1" name="logo"/>${graphic(1, 'logo', size)}</wp:anchor></w:drawing></w:r>`;
};

// Behind the text, from edge to edge of the page.
export const backgroundRun = (image, pageWidth, pageHeight) => {
  const size = { width: pageWidth * EMU, height: pageHeight * EMU };
  const at = '<wp:posOffset>0</wp:posOffset>';
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page">${at}</wp:positionH><wp:positionV relativeFrom="page">${at}</wp:positionV><wp:extent cx="${size.width}" cy="${size.height}"/><wp:wrapNone/><wp:docPr id="2" name="background"/>${graphic(2, 'background', size, cropToFill(image, pageWidth, pageHeight))}</wp:anchor></w:drawing></w:r>`;
};
