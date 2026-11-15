import {
  AutoParams, SequenceParams, NumberParams, DateParams, TextParams, PatternParams, DictParams,
  QueryParams, ConstantParams,
} from './simple';
import ListParams from './ListParams';
import BuiltinParams from './BuiltinParams';
import ExprParams from './ExprParams';
import FileParams from './FileParams';

// the form of the parameters of each rule kind; every one takes
// {base, tr, params, set(key, value), setParams(params), dataSource, entity, field, fileState}
export default {
  auto: AutoParams,
  sequence: SequenceParams,
  number: NumberParams,
  date: DateParams,
  text: TextParams,
  list: ListParams,
  pattern: PatternParams,
  dict: DictParams,
  builtin: BuiltinParams,
  file: FileParams,
  query: QueryParams,
  expr: ExprParams,
  constant: ConstantParams,
};
