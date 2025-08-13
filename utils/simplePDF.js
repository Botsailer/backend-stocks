/**
 * Simple PDF generation using basic PDF structure
 */

function generateSimplePDF(bill) {
  const formatCurrency = (amount) => `Rs.${amount.toLocaleString('en-IN')}`;
  const formatDate = (date) => new Date(date).toLocaleDateString('en-IN');
  
  const content = `BT
/F1 12 Tf
50 750 Td
(${bill.customerDetails.name}) Tj
0 -20 Td
(Invoice: ${bill.billNumber}) Tj
0 -20 Td
(Date: ${formatDate(bill.billDate)}) Tj
0 -20 Td
(Amount: ${formatCurrency(bill.totalAmount)}) Tj
0 -40 Td
(Items:) Tj
${bill.items.map(() => `
0 -20 Td
(Subscription - ${formatCurrency(bill.subtotal)}) Tj`).join('')}
0 -40 Td
(Subtotal: ${formatCurrency(bill.subtotal)}) Tj
0 -20 Td
(Tax: ${formatCurrency(bill.taxAmount)}) Tj
0 -20 Td
(Total: ${formatCurrency(bill.totalAmount)}) Tj
ET`;

  const pdfContent = `%PDF-1.4
1 0 obj
<</Type/Catalog/Pages 2 0 R>>
endobj
2 0 obj
<</Type/Pages/Kids[3 0 R]/Count 1>>
endobj
3 0 obj
<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>
endobj
4 0 obj
<</Length ${content.length}>>
stream
${content}
endstream
endobj
5 0 obj
<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>
endobj
xref
0 6
0000000000 65535 f
0000000010 00000 n
0000000053 00000 n
0000000125 00000 n
0000000348 00000 n
0000000565 00000 n
trailer
<</Size 6/Root 1 0 R>>
startxref
625
%%EOF`;

  return Buffer.from(pdfContent, 'utf8');
}



module.exports = { generateSimplePDF };