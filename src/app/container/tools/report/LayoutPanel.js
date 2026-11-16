import React from 'react';
import {
  FormatMessage, Input, Select, Checkbox, Button, Icon, Message, Upload,
} from 'components';
import {
  layoutOf, setLayout, PAGE_NUMBERS, COVER_FIELDS, IMAGE_FIELDS, MAX_IMAGE_BYTES,
} from '../../../../lib/report';

const Option = Select.Option;

// Word and the browser need the size of a picture to place it, so it is measured once here.
const readImage = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onload = () => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => resolve({ data: reader.result, width: img.naturalWidth, height: img.naturalHeight });
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// Cover, header, page numbers: what makes the report a document. A list has no chapters,
// so chapter numbers and the table of contents are left out for it.
export default React.memo(({ cls, draft, onChange }) => {
  const layout = layoutOf(draft);
  const set = change => onChange(setLayout(draft, change));
  const text = id => FormatMessage.string({ id: `report.layout.${id}` });
  const pick = (field) => {
    const fits = (file) => {
      const ok = ['image/png', 'image/jpeg'].includes(file.type) && file.size <= MAX_IMAGE_BYTES;
      if (!ok) Message.error({ title: text('imageInvalid') });
      return ok;
    };
    Upload('image/png,image/jpeg', (file) => {
      readImage(file).then(image => set({ [field]: image }))
        .catch(() => Message.error({ title: text('imageInvalid') }));
    }, fits, false);
  };
  const flags = ['cover', 'header', 'numbering', 'tocPages', 'landscape']
    .filter(f => draft.kind !== 'list' || !['numbering', 'tocPages'].includes(f));
  return <div className={`${cls}-layout`}>
    <div className={`${cls}-row`}>
      <span className={`${cls}-label`}>{text('title')}</span>
      {flags.map(f => <Checkbox
        key={f}
        className={`${cls}-layout-flag`}
        checked={layout[f]}
        onChange={e => set({ [f]: e.target.checked })}
      >{text(f)}</Checkbox>)}
    </div>
    <div className={`${cls}-row`}>
      <span className={`${cls}-label`}>{text('pageNumber')}</span>
      <Select notAllowEmpty value={layout.pageNumber} onChange={e => set({ pageNumber: e.target.value })}>
        {PAGE_NUMBERS.map(p => <Option key={p} value={p}>{text(`pageNumbers.${p}`)}</Option>)}
      </Select>
    </div>
    {layout.cover && <div className={`${cls}-layout-cover`}>
      {COVER_FIELDS.map(f => <div key={f} className={`${cls}-row`}>
        <span className={`${cls}-label`}>{text(f)}</span>
        <Input
          value={layout[f]}
          placeholder={text(`${f}Hint`)}
          onChange={e => set({ [f]: e.target.value })}
        />
      </div>)}
      {IMAGE_FIELDS.map(f => <div key={f} className={`${cls}-row`}>
        <span className={`${cls}-label`}>{text(f)}</span>
        {layout[f] && <img className={`${cls}-layout-thumb`} alt='' src={layout[f].data}/>}
        <Button onClick={() => pick(f)}><Icon type='fa-picture-o'/> {text(layout[f] ? 'imageChange' : 'imagePick')}</Button>
        {layout[f] && <a className='danger' title={text('imageRemove')} onClick={() => set({ [f]: null })}>
          <Icon type='fa-trash-o'/>
        </a>}
      </div>)}
    </div>}
    <div className={`${cls}-hint`}>{text('hint')}</div>
  </div>;
});
