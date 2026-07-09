const DEFAULT_TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";

let loadingPromise = null;

export async function loadTensorFlowJs({ url = DEFAULT_TFJS_URL } = {}) {
    if (globalThis.tf?.loadLayersModel) return globalThis.tf;
    if (!globalThis.document) {
        throw new Error("TensorFlow.js browser loader requires document.");
    }
    if (!loadingPromise) {
        loadingPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = url;
            script.async = true;
            script.onload = () => {
                if (globalThis.tf?.loadLayersModel) resolve(globalThis.tf);
                else reject(new Error("TensorFlow.js loaded without a usable tf global."));
            };
            script.onerror = () => reject(new Error(`Could not load TensorFlow.js from ${url}`));
            document.head.appendChild(script);
        });
    }
    return loadingPromise;
}
