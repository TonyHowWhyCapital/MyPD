// Word lists for the builtin generators. Original, common-knowledge data only:
// frequent surnames, characters often used in given names, generic road and
// company name parts. Names are always combined at random, no real person or
// company is listed here.

// most frequent first
export const TW_SURNAMES = ('陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高'
  + '潘簡朱鍾彭游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董溫唐藍石蔣古紀姚連馮'
  + '歐程湯田康姜白汪鄒尤巫黎涂龔嚴韓袁金童陸夏柳邵').split('');

export const TW_GIVEN_CHARS = ('家怡志雅俊淑美建明文宏惠玉佳嘉冠宗秀麗芳婷君宇承柏彥欣詩雯珊'
  + '慧玲華偉豪傑翔安廷哲瑋育信智仁德榮昌國正成永立世忠孝和平民生光輝義英春秋月雲琪涵萱筑蓉婉'
  + '靜宜庭妤芷晴恩祐睿軒翰凱維倫霖鈞緯群銘峰龍泰元富貴金珍珠鳳蘭梅菊琴娟瑜潔穎思語彤品妍子祥'
  + '勝進').split('');

export const TW_ROADS = [
  '中山路', '中正路', '中華路', '民生路', '民權路', '民族路', '忠孝路', '仁愛路', '信義路',
  '和平路', '復興路', '建國路', '光復路', '成功路', '文化路', '中興路', '自由路', '博愛路',
  '三民路', '大同路', '新生路', '林森路', '光明路', '民有街', '民享街', '公園路', '中央路',
  '站前路', '學府路', '大學路', '體育路', '工業路', '農場路', '水源路', '河堤路', '環河路',
  '東興街', '西安街', '南昌街', '北平街', '長安街', '永和街', '太平街', '福德街', '文昌街',
  '育英街', '勝利路', '光華路', '四維路', '八德路', '五福路', '七賢路', '九如路', '自強路',
  '力行路', '莒光路', '介壽路', '府前路', '市政路', '向上路',
];

// One character of each list makes the leading part of a company name. The characters are
// chosen away from the ones real companies are usually named with (永, 華, 聯, 宏, 大, 新 ...),
// so that no combination with a kind below is the name of a well-known company; the test
// goes through every combination against a list of such names.
export const TW_COMPANY_HEADS = '禾沐晴杉嵐澄岳楓柏雁鹿鯨霧曦棠樺湛漾熙禧穗聿芮荷蔚霏頤曜朔昀暘'.split('');

export const TW_COMPANY_TAILS = '森川原野田谷嶼岸洋月雲樹果木丘里境域匯點線格序翼途徑橋塔舟灣堂坊舍居閣苑園庭'
  .split('');

export const TW_COMPANY_KINDS = [
  '科技', '實業', '企業', '國際', '貿易', '工業', '電子', '資訊', '建設', '開發', '食品',
  '生技', '物流', '精密', '機械', '興業', '行銷', '顧問', '設計', '文創', '能源', '材料',
];

export const TW_COMPANY_SUFFIXES = ['股份有限公司', '股份有限公司', '有限公司', '有限公司', '企業社'];

// frequent characters for the `zh` charset of text rules
export const ZH_CHARS = '的一是不了人我在有他這中大來上國個到說們為子和你地出道也時年得就那要下以生會自著去之過'
  + '家學對可她裡後小麼心多天而能好都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見'
  + '經頭面公同三已老從動兩長知民樣現分將外但身些與高意進把法此實回二理美點月明其種聲全工己話兒'
  + '者向情部正名定女問力機給等幾很業最間新什打便位因重被走電四第門相次東政海口使教西再平真聽世'
  + '氣信北少關並內加化由卻代軍產入先山五太水萬市眼體別處總才場師書比住員九笑性通目華報立馬命張'
  + '活難神數件安表原車白應路期叫常提感金何更反合放做系計或司利受光王果親界及今京務制解各任至清'
  + '物台象記邊共風戰接它許八特覺望直服毛林題建南度統色字請交愛讓';

export const EN_FIRST_NAMES = [
  'James', 'Mary', 'John', 'Linda', 'Robert', 'Susan', 'Michael', 'Karen', 'William', 'Nancy',
  'David', 'Lisa', 'Richard', 'Betty', 'Joseph', 'Helen', 'Thomas', 'Sandra', 'Charles', 'Donna',
  'Daniel', 'Carol', 'Matthew', 'Ruth', 'Anthony', 'Sharon', 'Mark', 'Laura', 'Paul', 'Sarah',
  'Steven', 'Emily', 'Andrew', 'Anna', 'Kevin', 'Emma', 'Brian', 'Olivia', 'George', 'Grace',
  'Edward', 'Julia', 'Peter', 'Alice', 'Henry', 'Claire', 'Jack', 'Sophie', 'Oliver', 'Lucy',
  'Samuel', 'Hannah', 'Benjamin', 'Chloe', 'Nathan', 'Megan', 'Adam', 'Rachel', 'Ryan', 'Amy',
];

export const EN_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson',
  'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White', 'Harris', 'Clark',
  'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Hill', 'Green',
  'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Campbell',
  'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart', 'Morris', 'Rogers', 'Reed', 'Cook',
  'Morgan', 'Bell', 'Murphy', 'Bailey', 'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward',
  'Brooks', 'Gray', 'Watson', 'Wood', 'Bennett',
];

export const EN_COMPANY_WORDS = [
  'Apex', 'Summit', 'Pioneer', 'Harbor', 'Cedar', 'Granite', 'Lumen', 'Vertex', 'Atlas',
  'Beacon', 'Crest', 'Delta', 'Ember', 'Falcon', 'Garnet', 'Horizon', 'Ivory', 'Juniper',
  'Keystone', 'Lantern', 'Meridian', 'Nimbus', 'Orchard', 'Prairie', 'Quartz', 'Redwood',
  'Sterling', 'Timber', 'Unity', 'Valley', 'Willow', 'Zenith',
];

export const EN_COMPANY_KINDS = [
  'Systems', 'Labs', 'Holdings', 'Logistics', 'Foods', 'Trading', 'Solutions', 'Industries',
  'Partners', 'Works', 'Media', 'Energy',
];

export const EN_COMPANY_SUFFIXES = ['Inc.', 'LLC', 'Ltd.', 'Co.', 'Group', 'Corp.'];

// reserved for documentation and testing, never real mailboxes or sites
export const SAFE_DOMAINS = ['example.com', 'example.org', 'example.net'];

export const URL_PATHS = [
  '', 'home', 'about', 'products', 'news', 'contact', 'blog', 'docs', 'help', 'search',
];
