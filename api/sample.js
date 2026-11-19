// GET /api/sample : opens a sample receipt, so visitors can see one before signing anything.
const { buildSale } = require("../lib/sale");
const token = require("../lib/token");
const { fail } = require("../lib/http");

module.exports = (req, res) => {
  try {
    const sale = buildSale({
      id: "SAMPLE",
      business: { name: "Mama Tee's Kitchen", phone: "+234 801 234 5678", address: "12 Allen Avenue, Ikeja, Lagos", currency: "₦" },
      customer: { name: "Ada Okafor", phone: "2348012345678" },
      method: "transfer", reference: "TRF-20481",
      items: [{ name: "Jollof rice and chicken", qty: 2, price: 3500 }, { name: "Small chops platter", qty: 1, price: 8000 }, { name: "Zobo (50cl)", qty: 3, price: 700 }],
    });
    res.statusCode = 302;
    res.setHeader("Location", `/r/${token.encode(sale)}`);
    res.setHeader("Cache-Control", "no-store");
    res.end();
  } catch (e) {
    fail(res, e);
  }
};
