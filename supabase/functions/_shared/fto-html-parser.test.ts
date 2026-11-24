import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseGovernmentFtoDetailHtml } from "./fto-html-parser.ts";

// Synthetic structural fixture only. This is not captured Government portal HTML.
const SYNTHETIC_DETAIL_HTML = `
<html><body>
  <h2>FTO Transaction Details</h2>
  <table>
    <tr>
      <th>Job Card No/Panchayat Name</th><th>Reference No</th><th>Transaction Date</th>
      <th>Applicant Name</th><th>Name of Primary Account Holder</th>
      <th>Amount to be Credited in Rs</th><th>Credit Amount in Rs</th>
      <th>Status</th><th>Processed Date</th><th>Rejection Reason</th>
    </tr>
    <tr>
      <td>New Serchhip North (MZ-07-001-002-003/001)</td><td>REF-001</td><td>17/11/2026</td>
      <td>Applicant One</td><td>Household Head</td><td>₹ 1,000.00</td><td>₹ 950.00</td>
      <td>Processed</td><td>18/11/2026</td><td></td>
    </tr>
    <tr>
      <td>Other Village (MZ-07-001-002-004/002)</td><td>REF-002</td><td>17/11/2026</td>
      <td>Applicant Two</td><td>Household Head Two</td><td>500</td><td>500</td>
      <td></td><td></td><td></td>
    </tr>
    <tr><td colspan="10">SubTotal</td></tr>
    <tr><td colspan="10">Total</td></tr>
  </table>
  <table>
    <tr><th>S.No.</th><th>Block_name</th><th>Fto No</th><th>Bank Name/HO Name</th><th>Amount</th></tr>
    <tr><td>1</td><td>serchhip</td><td>FTO-TEST-001</td><td>Mizoram Rural Bank</td><td>1,450</td></tr>
  </table>
</body></html>`;

Deno.test("parses transaction rows from a synthetic detail-page fixture", () => {
  const rows = parseGovernmentFtoDetailHtml(SYNTHETIC_DETAIL_HTML, "FTO-TEST-001");
  assertEquals(rows.length, 2);
  assertEquals(rows[0].jobCardNumber, "MZ-07-001-002-003/001");
  assertEquals(rows[0].village, "New Serchhip North");
  assertEquals(rows[0].referenceNumber, "REF-001");
  assertEquals(rows[0].normalizedStatus, "processed");
  assertEquals(rows[0].creditAmount, "950");
  assertEquals(rows[0].transactionDate, "2026-11-17");
  assertEquals(rows[0].processedDate, "2026-11-18");
  assertEquals(rows[1].normalizedStatus, "blank");
  assertEquals(rows[1].status, "deferred");
  assertEquals(rows[1].village, "Other Village");
});

Deno.test("rejects pages without the expected FTO detail title and headers", () => {
  assertThrows(
    () => parseGovernmentFtoDetailHtml("<html><body><table><tr><td>Hello</td></tr></table></body></html>", "FTO-TEST-002"),
    Error,
    "did not return a valid FTO Transaction Details page.",
  );
});
