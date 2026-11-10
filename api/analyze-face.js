// ================================================================
//  api/analyze-face.js - وكيل Vercel لتحليل صورة الوجه
//  يستدعي Google Cloud Vision API ويعيد جميع البيانات اللازمة
//  للتحقق من جودة الصورة (الزوايا، المعالم، الإضاءة، الحجم، عدد الوجوه)
// ================================================================

const VISION_API_KEY = process.env.VISION_API_KEY;

export default async function handler(req, res) {
    // 1. CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
    }

    try {
        const { image } = req.body;

        if (!image) {
            return res.status(400).json({ success: false, error: 'missing_image' });
        }

        // 2. تنظيف الـ Base64
        let cleanBase64 = image;
        if (image.includes(',')) {
            cleanBase64 = image.split(',')[1];
        }

        // 3. استدعاء Google Cloud Vision API
        const url = `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`;

        const payload = {
            requests: [{
                image: { content: cleanBase64 },
                features: [{ type: 'FACE_DETECTION', maxResults: 10 }] // ✅ زيادة maxResults للكشف عن وجوه متعددة
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // 4. التحقق من الاستجابة
        if (!response.ok) {
            console.error('❌ Vision API error:', data);
            return res.status(response.status).json({
                success: false,
                error: data.error?.message || 'حدث خطأ في خدمة تحليل الصور',
                details: data
            });
        }

        // 5. استخراج معلومات الوجوه
        const faceAnnotations = data.responses?.[0]?.faceAnnotations || [];
        const faceCount = faceAnnotations.length;

        // 6. إذا لم يكن هناك وجوه
        if (faceCount === 0) {
            return res.status(200).json({
                success: false,
                error: 'no_face_detected',
                faceCount: 0,
                detectionConfidence: 0
            });
        }

        // 7. تحليل الوجه الأول فقط (للاستخدام في الفحوصات الأخرى)
        const face = faceAnnotations[0];

        // 8. استخراج مربع الوجه (boundingPoly)
        const vertices = face.boundingPoly?.vertices || [];
        let faceBoundingBox = { x: 0, y: 0, width: 0, height: 0 };
        if (vertices.length === 4) {
            const xs = vertices.map(v => v.x);
            const ys = vertices.map(v => v.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            faceBoundingBox = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            };
        }

        // 9. إرجاع جميع البيانات
        return res.status(200).json({
            success: true,
            faceCount: faceCount, // ✅ عدد الوجوه المكتشفة
            detectionConfidence: face.detectionConfidence || 0,
            landmarkingConfidence: face.landmarkingConfidence || 0,
            rollAngle: face.rollAngle || 0,
            panAngle: face.panAngle || 0,
            tiltAngle: face.tiltAngle || 0,
            blurredLikelihood: face.blurredLikelihood || 'UNKNOWN',
            headwearLikelihood: face.headwearLikelihood || 'UNKNOWN',
            underExposedLikelihood: face.underExposedLikelihood || 'UNKNOWN',
            faceBoundingBox: faceBoundingBox
        });

    } catch (error) {
        console.error('❌ Proxy error:', error);
        return res.status(500).json({
            success: false,
            error: 'proxy_error',
            message: error.message
        });
    }
}