export default function jaccardSimilarity(setA, setB) {
    const intersection = new Set([...setA].filter(token => setB.has(token)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}