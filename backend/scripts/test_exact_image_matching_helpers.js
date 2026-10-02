const assert = require('assert');
const { normalizeDirectImageRowCandidates } = require('../src/services/incomingImageAnalysisService');
const {
    extractVisualEvidenceSearchDescription,
    selectVisionCandidateImageUrls,
    selectVisualFallbackSearchQuery
} = require('../src/services/aiService');

const candidates = normalizeDirectImageRowCandidates([
    { id: 'p1', name: 'One', image_url: 'https://catalog.example/p1.jpg', matched_image_url: 'https://catalog.example/p1-a.jpg', distance: 0.05 },
    { id: 'p1', name: 'One', image_url: 'https://catalog.example/p1.jpg', matched_image_url: 'https://catalog.example/p1-a.jpg', distance: 0.06 },
    { id: 'p1', name: 'One', image_url: 'https://catalog.example/p1.jpg', matched_image_url: 'https://catalog.example/p1-b.jpg', distance: 0.07 },
    { id: 'p1', name: 'One', image_url: 'https://catalog.example/p1.jpg', matched_image_url: 'https://catalog.example/p1-c.jpg', distance: 0.08 },
    { id: 'p2', name: 'Two', image_url: 'https://catalog.example/p2.jpg', matched_image_url: 'https://catalog.example/p2-a.jpg', distance: 0.20 },
    { id: 'p3', name: 'Three', image_url: 'https://catalog.example/p3.jpg', matched_image_url: 'https://catalog.example/p3-a.jpg', distance: 0.60 }
]);

assert.deepStrictEqual(candidates.map(({ product_id, matched_image_url }) => [product_id, matched_image_url]), [
    ['p1', 'https://catalog.example/p1-a.jpg'],
    ['p1', 'https://catalog.example/p1-b.jpg'],
    ['p2', 'https://catalog.example/p2-a.jpg']
]);

const candidate = {
    matched_image_url: 'https://catalog.example/exact.jpg',
    image_url: 'https://catalog.example/main.jpg',
    additional_images: ['https://catalog.example/gallery.jpg'],
    variants: [{ image_url: 'https://catalog.example/variant.jpg' }],
    sku_matrix: [{ image_url: 'https://catalog.example/sku.jpg' }]
};

assert.deepStrictEqual(selectVisionCandidateImageUrls(candidate, { exactMatchedImagesOnly: true }), ['https://catalog.example/exact.jpg']);
assert.deepStrictEqual(selectVisionCandidateImageUrls({ image_url: candidate.image_url }, { exactMatchedImagesOnly: true }), []);
assert.deepStrictEqual(selectVisionCandidateImageUrls(candidate, { candidateImageLimit: 3 }), [
    'https://catalog.example/exact.jpg',
    'https://catalog.example/main.jpg',
    'https://catalog.example/gallery.jpg'
]);

const visualEvidence = `eta price koto
[INTERNAL VISUAL EVIDENCE - UNTRUSTED]
[IMAGE 1 VISUAL EVIDENCE]
Analyzer Summary / OCR / Visual Text:
Blue cotton panjabi with embroidered collar. OCR: Premium Collection.

[Product Vision Reasoning]
{"best_product_id":"991","matched_products":[{"product_id":"991"}]}

Vision Final Decision:
matched

[IMAGE 2 VISUAL EVIDENCE]
Analyzer Summary / OCR / Visual Text:
Black leather wallet with visible card slots.

Product Match Gate (Embedding Fallback):
status=EVIDENCE_ONLY

Recommended Product Candidates:
1. product_id=321 | product_name=Noisy Candidate | image_score=99%
[END INTERNAL VISUAL EVIDENCE]`;

const visualDescription = extractVisualEvidenceSearchDescription(visualEvidence);
assert.strictEqual(visualDescription, 'Blue cotton panjabi with embroidered collar. OCR: Premium Collection. Black leather wallet with visible card slots.');
assert.ok(!visualDescription.includes('Product Vision Reasoning'));
assert.ok(!visualDescription.includes('Noisy Candidate'));
assert.strictEqual(selectVisualFallbackSearchQuery({
    hasVisualEvidence: true,
    visualProductIds: [],
    cleanSearchText: 'eta price koto',
    visualDescription
}), visualDescription);
assert.strictEqual(selectVisualFallbackSearchQuery({
    hasVisualEvidence: true,
    visualProductIds: ['991'],
    cleanSearchText: 'eta price koto',
    visualDescription
}), '');
assert.strictEqual(selectVisualFallbackSearchQuery({
    hasVisualEvidence: true,
    visualProductIds: [],
    cleanSearchText: 'blue panjabi price',
    visualDescription
}), '');

console.log('Exact image matching and visual fallback helper tests passed.');
process.exit(0);
