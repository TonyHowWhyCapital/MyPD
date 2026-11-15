// The formula of an `expr` rule, with the functions and the columns that can be put in.
import React, { useRef } from 'react';
import { Row } from './common';
import { EXPR_SIGNATURES, problemText } from '../ruleText';
import { EXPR_FUNCTIONS, checkExpr } from '../../../../../../lib/testdata/expr';

export default ({
  base, tr, params, set, entity, field,
}) => {
  const box = useRef(null);
  const text = params.expr || '';
  const problem = text.trim() === '' ? null : checkExpr(text);
  // puts `piece` where the cursor is (or over what is selected); `inside` leaves the
  // cursor between the brackets of a function
  const insert = (piece, inside) => {
    const { current } = box;
    const start = current ? current.selectionStart : text.length;
    const end = current ? current.selectionEnd : text.length;
    set('expr', text.slice(0, start) + piece + text.slice(end));
    if (current) {
      const caret = start + piece.length - (inside ? 1 : 0);
      setTimeout(() => {
        current.focus();
        current.setSelectionRange(caret, caret);
      }, 0);
    }
  };
  const locate = () => {
    if (box.current && problem) {
      box.current.focus();
      box.current.setSelectionRange(problem.pos, Math.min(text.length, problem.pos + 1));
    }
  };
  const columns = ((entity && entity.fields) || [])
    .filter(f => f.defKey && (!field || f.id !== field.id));
  return <React.Fragment>
    <Row base={base} label={tr('param.expr')} hint={tr('hint.expr')} wide>
      <textarea
        ref={box}
        className={`${base}-code`}
        rows={3}
        spellCheck={false}
        placeholder='[PRICE] * [QTY]'
        value={text}
        onChange={e => set('expr', e.target.value)}
      />
      {problem && <div className={`${base}-expr-error`} onClick={locate}>
        {problemText(tr, problem.code, { pos: problem.pos })}
      </div>}
    </Row>
    <Row base={base} label={tr('hint.exprColumns')} wide>
      {columns.length === 0
        ? <div className={`${base}-form-hint`}>{tr('hint.exprNoColumns')}</div>
        : <div className={`${base}-chips ${base}-chips-scroll`} title={tr('hint.exprInsert')}>
          {columns.map(f => (
            <span
              key={f.id}
              className={`${base}-chip`}
              title={f.defName || f.defKey}
              onClick={() => insert(`[${f.defKey}]`)}
            >{f.defKey}
            </span>))}
        </div>}
    </Row>
    <Row base={base} label={tr('hint.exprFunctions')} wide>
      <div className={`${base}-functions`} title={tr('hint.exprInsert')}>
        {EXPR_FUNCTIONS.map((name) => {
          const [signature, example] = EXPR_SIGNATURES[name] || [`${name}()`, `${name}()`];
          return <div
            key={name}
            className={`${base}-function`}
            title={example}
            onClick={() => insert(`${name}()`, !signature.endsWith('()'))}
          >
            <code>{signature}</code>
            <span>{tr(`fn.${name}`)}</span>
          </div>;
        })}
      </div>
    </Row>
  </React.Fragment>;
};
