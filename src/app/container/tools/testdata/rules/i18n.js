import { FormatMessage } from 'components';

// text of `testDataRule.<id>` in the language in use; '' when there is none
export const tr = (id, data) => FormatMessage.string({
  id: `testDataRule.${id}`,
  defaultMessage: '',
  data,
});

export default tr;
