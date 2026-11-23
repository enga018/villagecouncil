import { assertEquals } from "jsr:@std/assert@1";
import { findBlockSignedCountControl } from "./index.ts";

// Structure transcribed from the Government FTO Status screenshot:
// grouped 1st Signatory header, followed by Signed and Pending subcolumns.
Deno.test("selects the 1st Signatory No. of Signed FTO link for the exact Block row", () => {
  const html = `
    <table>
      <tr>
        <th rowspan="2">S.No</th><th rowspan="2">Block</th><th rowspan="2">Total FTO Generated</th>
        <th colspan="2">1st Signatory</th><th colspan="2">2nd Signatory</th>
      </tr>
      <tr>
        <th>No. of Signed FTO</th><th>No. of FTO Pending</th>
        <th>No. of Signed FTO</th><th>No. of FTO Pending</th>
      </tr>
      <tr>
        <td>1</td><td>serchhip</td><td><a href="/VBGRAMG/FTO/total.aspx?payload=total">371</a></td>
        <td><a href="/VBGRAMG/FTO/first.aspx?payload=first">371</a></td><td>0</td>
        <td><a href="/VBGRAMG/FTO/second.aspx?payload=second">0</a></td><td>0</td>
      </tr>
    </table>`;
  const result = findBlockSignedCountControl(html, "https://vbgramgrep.dord.gov.in/VBGRAMG/FTO/status.aspx", "serchhip");
  assertEquals(result.count, 371);
  assertEquals(result.control.kind, "link");
  if (result.control.kind === "link") {
    assertEquals(result.control.href, "https://vbgramgrep.dord.gov.in/VBGRAMG/FTO/first.aspx?payload=first");
  }
});

Deno.test("does not confuse the signed FTO count with the pending or second-signatory columns", () => {
  const html = `
    <table>
      <tr><th rowspan="2">Block</th><th colspan="2">1st Signatory</th><th colspan="2">2nd Signatory</th></tr>
      <tr><th>No. of Signed FTO</th><th>No. of FTO Pending</th><th>No. of Signed FTO</th><th>No. of FTO Pending</th></tr>
      <tr><td>serchhip</td><td>371</td><td><a href="/VBGRAMG/FTO/pending.aspx?payload=pending">0</a></td><td><a href="/VBGRAMG/FTO/second.aspx?payload=second">88</a></td><td>0</td></tr>
    </table>`;
  let message = "";
  try {
    findBlockSignedCountControl(html, "https://vbgramgrep.dord.gov.in/VBGRAMG/FTO/status.aspx", "serchhip");
  } catch (error) { message = String(error); }
  assertEquals(message.includes("Could not find"), true);
});
