/** @OnlyCurrentDoc */

/**
 * honno.infoの書誌情報を B:H の列順で返す。
 * @param {string|number} isbn ISBN-13またはISBN-10。
 * @return {string[][]} 出版社、発売日、著者、書名、価格、判型、レーベル。
 * @customfunction
 */
function HONNO_BOOK_XML(isbn) {
  const fields = ['publisher', 'pdate', 'author', 'title', 'price', 'size', 'series'];
  if (isbn === '' || isbn == null) return [fields.map(() => '')];
  if (!SpreadsheetApp.getActiveSpreadsheet()) {
    throw new Error('スプレッドシートのセルから実行してください。');
  }

  const isbn13 = normalizeIsbn13ForImage_(isbn);
  const checksum = Array.from(isbn13).reduce((sum, digit, index) =>
    sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  if (!/^97[89]\d{10}$/.test(isbn13) || checksum % 10 !== 0) {
    throw new Error('ISBNを確認してください。');
  }

  const url = 'https://honno.info/bsdx/openbdtoxml.php?isbn=' + encodeURIComponent(isbn13);
  const items = fetchHonnoBookItems_(url);
  if (items.getName() !== 'items' || !fields.some(field => items.getChild(field))) {
    throw new Error('honno.info の応答形式を確認してください。');
  }

  return [fields.map(field => (items.getChildText(field) || '').trim())];
}

function fetchHonnoBookItems_(url) {
  const started = Date.now();
  let message;
  for (let attempt = 0; attempt < 2; attempt++) {
    let status;
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      status = response.getResponseCode();
      if (status === 200) return XmlService.parse(response.getContentText('UTF-8')).getRootElement();
      message = 'honno.info から書誌情報を取得できませんでした（HTTP ' + status + '）。';
    } catch (error) {
      message = status === 200 ? 'honno.info のXMLを読み取れませんでした。' :
        'honno.info と通信できませんでした。';
    }
    const retryable = !status || [200, 408, 429, 500, 502, 503, 504].includes(status);
    if (!retryable || attempt === 1 || Date.now() - started >= 5000) break;
    // Normal requests return immediately. Stagger retries for closely spaced scans.
    Utilities.sleep(300 + Math.floor(Math.random() * 200));
  }
  throw new Error(message);
}
