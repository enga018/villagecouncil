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

// Structure captured from a live Government FTO detail page. Applicant names are replaced with placeholders.
// The Panchayat cell is blank on the portal and renders as "()" after the Job Card number.
const CAPTURED_BLANK_PANCHAYAT_HTML = `
<html><body>
  <h2>FTO Transaction Details</h2>
  <table>
    <tr>
      <th>S.No</th><th>Block Name</th><th>Job Card No.<br>(Panchayat Name)</th><th>Reference No.</th>
      <th>Transaction Date</th><th>Applicant Name</th><th>Wagelist No.</th><th>Name of Primary Account Holder</th>
      <th>Bank Code</th><th>IFSC code</th><th>Amount to be credited (In Rs.)</th><th>Credit Amount(In Rs.)</th>
      <th>Status</th><th>Processed Date</th><th>Bank To co-operative/postoffice Processed Date</th>
      <th>UTR No.</th><th>Rejection Reason</th><th>Paid in account of (in case of ABP)</th><th>Paid in Bank (in case of ABP)</th>
    </tr>
    <tr>
      <td>1</td><td>serchhip</td><td>MZ-02-001-028-001/1<br>()</td><td>2202001000VBG27270820260106362</td>
      <td>29/08/2026</td><td>APPLICANT A</td><td>2202001WL000203</td><td>APPLICANT A</td>
      <td>00293</td><td>SBIN0RRMIGB</td><td>2100</td><td>2100</td>
      <td>Processed</td><td>23/09/2026</td><td></td><td>003806</td><td></td><td>APPLICANT A</td><td></td>
    </tr>
    <tr>
      <td>2</td><td>serchhip</td><td>New Serchhip North (MZ-07-001-005-001/835)</td><td>REF-PLACEHOLDER-2</td>
      <td>29/08/2026</td><td>APPLICANT B</td><td>2202001WL000203</td><td>APPLICANT B</td>
      <td>00293</td><td>SBIN0RRMIGB</td><td>1800</td><td>1800</td>
      <td>Processed</td><td>23/09/2026</td><td></td><td>003725</td><td></td><td>APPLICANT B</td><td></td>
    </tr>
    <tr><td>SubTotal</td><td>3900</td><td>3900</td></tr>
    <tr><td>Total</td><td>3900</td><td>3900</td></tr>
  </table>
  <table>
    <tr><th>S.No.</th><th>Block_name</th><th>Fto No</th><th>Bank Name/HO Name</th><th>Amount</th></tr>
    <tr><td>1</td><td>serchhip</td><td>FTO-TEST-003</td><td>Mizoram Rural Bank</td><td>3900</td></tr>
  </table>
</body></html>`;

Deno.test("keeps a blank Panchayat cell as an empty village instead of inventing one", () => {
  const rows = parseGovernmentFtoDetailHtml(CAPTURED_BLANK_PANCHAYAT_HTML, "FTO-TEST-003");
  assertEquals(rows.length, 2);
  assertEquals(rows[0].jobCardNumber, "MZ-02-001-028-001/1");
  assertEquals(rows[0].village, "");
  assertEquals(rows[0].normalizedStatus, "processed");
  assertEquals(rows[0].creditAmount, "2100");
  assertEquals(rows[1].jobCardNumber, "MZ-07-001-005-001/835");
  assertEquals(rows[1].village, "New Serchhip North");
});

Deno.test("rejects pages without the expected FTO detail title and headers", () => {
  assertThrows(
    () => parseGovernmentFtoDetailHtml("<html><body><table><tr><td>Hello</td></tr></table></body></html>", "FTO-TEST-002"),
    Error,
    "did not return a valid FTO Transaction Details page.",
  );
});
