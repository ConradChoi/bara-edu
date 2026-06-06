/**
 * 바라 평생교육원 — Coming Soon 사전 신청 수집
 * Google Apps Script (Web App)
 *
 * 배포 방법:
 *   확장 프로그램 > Apps Script > 새 스크립트 > 아래 코드 붙여넣기
 *   배포 > 새 배포 > 웹 앱
 *     - 다음 사용자로 실행: 나(내 계정)
 *     - 액세스 권한: 모든 사용자
 *   배포 URL을 .env.local의 NEXT_PUBLIC_APPS_SCRIPT_URL에 입력
 *
 * Sheets 구조 (자동 생성):
 *   시트명: 사전신청
 *   컬럼: A=신청일시, B=이메일, C=출처
 */

var SHEET_NAME = "사전신청";

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["신청일시", "이메일", "출처"]);
    sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
  }
  return sheet;
}

function isDuplicate(sheet, email) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === email) return true;
  }
  return false;
}

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var body = JSON.parse(e.postData.contents);
    var email = (body.email || "").trim().toLowerCase();
    var source = body.source || "coming-soon";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      output.setContent(JSON.stringify({ ok: false, error: "유효하지 않은 이메일입니다." }));
      return output;
    }

    var sheet = getOrCreateSheet();

    if (isDuplicate(sheet, email)) {
      output.setContent(JSON.stringify({ status: 409, error: "이미 신청된 이메일입니다." }));
      return output;
    }

    var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([now, email, source]);

    output.setContent(JSON.stringify({ ok: true }));
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: "서버 오류가 발생했습니다." }));
  }

  return output;
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: "바라 평생교육원 사전신청 API" })
  ).setMimeType(ContentService.MimeType.JSON);
}
