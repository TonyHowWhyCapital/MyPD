import { FormatMessage } from 'components';

// text of `testData.<id>` in the language in use; '' when there is none
export const tr = (id, data) => FormatMessage.string({
  id: `testData.${id}`,
  defaultMessage: '',
  data,
});

export default tr;
