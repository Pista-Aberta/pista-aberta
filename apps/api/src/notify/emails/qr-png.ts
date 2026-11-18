/** QR PNG real para adxuntos CID (mesmo payload ca a app). */
import QRCode from "qrcode";

export async function buildQrPng(
  payload: string,
  size = 180,
): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: "png",
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}
