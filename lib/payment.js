const axios = require("axios");
const qs = require("qs");
const QRCode = require("qrcode");

const PAKASIR_BASE = "https://app.pakasir.com/api";
const ATL_BASE = "https://atlantich2h.com";

const toRupiah = (angka) => {
  return Number(angka).toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).replace("IDR", "Rp").trim();
};

function generateReffId() {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `TRX-${Date.now()}-${rand}`;
}

function sanitizeQrString(s) {
  if (!s || typeof s !== 'string') return null;
  const idx = s.indexOf('000201');
  if (idx !== -1) return s.slice(idx).trim();
  return s.trim();
}

async function downloadQrisImage(url) {
  try {
    if (!url || !url.startsWith('http')) return null;
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 10000, 
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://atlantich2h.com/'
      }
    });
    return Buffer.from(response.data);
  } catch (error) {
    return null;
  }
}

// Trigger Instant Check Khusus Atlantic
async function triggerAtlanticInstant(id, config) {
  try {
    await axios.post(
      `${ATL_BASE}/deposit/instant`,
      qs.stringify({
        api_key: config.apiAtlantic,
        id: String(id),
        action: 'true'
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 5000
      }
    );
  } catch (e) {
    // Normal jika sudah sukses
  }
}

async function createdQris(harga, config) {
  const amount = Number(harga);

  // ================= PAYMENT: ATLANTIC =================
  if (config.method === "atlantic") {
    try {
      const reffId = generateReffId();
      const body = {
        api_key: config.apiAtlantic,
        reff_id: reffId,
        nominal: amount,
        type: "ewallet",
        metode: "QRIS",
      };

      const res = await axios.post(`${ATL_BASE}/deposit/create`, qs.stringify(body), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000
      });

      if (!res.data?.data) return null;
      const d = res.data.data;
      
      return {
        idtransaksi: d.id, 
        jumlah: amount,
        imageqris: d.qr_image || "",
        qr_string: d.qr_string || "",
        nominal: amount,
      };
    } catch (e) {
      console.error("[ATLANTIC CREATE ERROR]", e.response?.data || e.message);
      return null;
    }
  }

  // ================= PAYMENT: PAKASIR =================
  if (config.method === "pakasir") {
    try {
      const orderId = generateReffId();
      const payload = {
          project: config.project,
          order_id: orderId,
          amount: amount,
          api_key: config.apikey
      };

      const { data } = await axios.post(`${PAKASIR_BASE}/transactioncreate/qris`, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 15000
      });

      if (!data || !data.payment) return null;

      const payment = data.payment;
      const candidates = [payment.qr_string, payment.qr, data.qr_string, data.qr, payment.payment_number]
        .filter(v => typeof v === 'string' && v.trim().length > 0);
      
      let qrString = null;
      for (const c of candidates) {
        const emv = sanitizeQrString(c);
        if (emv && emv.startsWith('000201')) {
          qrString = emv;
          break;
        }
      }

      if (!qrString) return null;

      const qrBuffer = await QRCode.toBuffer(qrString, { errorCorrectionLevel: 'M', width: 512, margin: 1 });

      return {
        idtransaksi: payment.order_id,
        jumlah: payment.total_payment,
        imageqris: qrBuffer, // Pakasir mengembalikan Buffer QR
        qr_string: qrString,
        nominal: payment.amount,
        expired_at: payment.expired_at
      };
    } catch (e) {
      console.error("[PAKASIR CREATE ERROR]", e.response?.data || e.message);
      return null;
    }
  }

  return null;
}

async function cekStatus(id, amount, config) {
  // ================= STATUS: ATLANTIC =================
  if (config.method === "atlantic") {
    try {
      const res = await axios.post(`${ATL_BASE}/deposit/status`, qs.stringify({
          api_key: config.apiAtlantic,
          id: String(id),
        }),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 10000
        }
      );

      const status = res.data?.data?.status?.toLowerCase();
      if (status === "success") return true;
      if (status === "processing") {
        await triggerAtlanticInstant(id, config);
        return false; 
      }
      return false;
    } catch (e) {
      console.error("[ATLANTIC STATUS ERROR]", e.message);
      return false;
    }
  }

  // ================= STATUS: PAKASIR =================
  if (config.method === "pakasir") {
    try {
      const url = `${PAKASIR_BASE}/transactiondetail?project=${config.project}&amount=${amount}&order_id=${id}&api_key=${config.apikey}`;
      const { data } = await axios.get(url, { timeout: 10000 });
      if (data && data.transaction && data.transaction.status === 'completed') return true;
      return false;
    } catch (e) {
      if (e.response && e.response.status === 404) return false;
      console.error("[PAKASIR STATUS ERROR]", e.message);
      return false;
    }
  }

  return false;
}

module.exports = {
  createdQris,
  cekStatus,
  toRupiah,
  downloadQrisImage 
};
