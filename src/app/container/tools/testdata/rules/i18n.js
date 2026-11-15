import { FormatMessage } from 'components';

// text of `testDataRule.<id>` in the language in use; '' when there is none
export const tr = (id, data) => FormatMessage.string({
  id: `testDataRule.${id}`,
  defaultMessage: '',
  data,
});

// text of a full language key, for words shared between the windows of test data
export const say = (id, data) => FormatMessage.string({ id, defaultMessage: '', data });

export default tr;
