import { Router } from "express";
import multer from "multer";

const r = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) => {
    if (!file.mimetype.startsWith("image/")) return done(new Error("Only image files are allowed"));
    done(null, true);
  },
});

r.post("/", upload.single("image"), async (req, res) => {
  if (!process.env.IMGBB_API_KEY) return res.status(503).json({ message: "Image hosting is not configured on the server" });
  if (!req.file) return res.status(400).json({ message: "Choose an image to upload" });

  const form = new FormData();
  form.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

  let response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, {
      method: "POST",
      body: form,
    });
  } catch {
    return res.status(502).json({ message: "Image hosting service could not be reached" });
  }

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success || !result?.data?.url) {
    return res.status(502).json({ message: "Image upload failed. Please try another image" });
  }

  res.status(201).json({ url: result.data.url });
});

export default r;
