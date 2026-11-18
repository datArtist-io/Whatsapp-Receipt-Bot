// whatsapp.js
// Thin wrapper around Meta's WhatsApp Cloud API.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}`;

/**
 * Uploads a local PDF file to WhatsApp's media endpoint and returns a media id.
 */
async function uploadMedia(filePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), {
    contentType: "application/pdf",
  });
  form.append("messaging_product", "whatsapp");

  const res = await axios.post(`${BASE_URL}/media`, form, {
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      ...form.getHeaders(),
    },
  });
  return res.data.id;
}

/**
 * Sends the receipt PDF as a document message.
 * NOTE: WhatsApp only allows free-form messages (like this) within a 24-hour
 * window after the customer last messaged you. Outside that window, you must
 * use a pre-approved message TEMPLATE instead. See README for details.
 */
async function sendReceiptDocument(toPhone, filePath, filename = "receipt.pdf", caption = "Here is your receipt. Thank you!") {
  const mediaId = await uploadMedia(filePath);

  const res = await axios.post(
    `${BASE_URL}/messages`,
    {
      messaging_product: "whatsapp",
      to: toPhone, // international format, no leading +, e.g. 2348012345678
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}

/**
 * Sends a receipt using a pre-approved TEMPLATE message.
 * Use this if you need to message a customer who hasn't messaged you in the
 * last 24 hours (e.g. immediately after an online payment, unprompted).
 * You must first create and get this template approved in Meta Business Manager.
 *
 * Example template body: "Hi {{1}}, thanks for your payment of {{2}}. Your receipt is attached."
 */
async function sendReceiptTemplate(toPhone, templateName, languageCode, bodyParams = []) {
  const res = await axios.post(
    `${BASE_URL}/messages`,
    {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((p) => ({ type: "text", text: String(p) })),
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  return res.data;
}

module.exports = { uploadMedia, sendReceiptDocument, sendReceiptTemplate };
