import type { VisualProjectAsset, VisualSceneState, VisualTextureSlot } from "./visualsScene.ts";

const textureKeys = ["baseColorMap","normalMap","bumpMap","roughnessMap","metalnessMap","aoMap","emissiveMap","alphaMap","displacementMap","envMap"] as const;

function recoveredId(kind: VisualProjectAsset["kind"], url: string): string {
	let hash = 2166136261;
	for (const char of `${kind}:${url}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return `asset-recovered-${kind}-${(hash >>> 0).toString(36)}`;
}

export function recoverProjectAssets(scene: VisualSceneState): VisualProjectAsset[] {
	const assets = [...scene.projectAssets];
	const add = (kind: VisualProjectAsset["kind"], url: string, name: string, provenance: string) => {
		if (!url || assets.some(asset => asset.kind === kind && asset.url === url)) return;
		assets.push({id: recoveredId(kind, url), kind, url, name: name || "Imported asset", provenance, status: "available"});
	};
	add("model", scene.object.modelUrl, scene.object.modelFileName, "Existing project");
	for (const file of scene.object.assetFiles) {
		if (file.url === scene.object.modelUrl) continue;
		add(/\.(hdr|exr)$/i.test(file.fileName) ? "environment" : "texture", file.url, file.fileName, file.path || "Model package");
	}
	for (const material of scene.materials) {
		if (material.id !== "material-default") add("material", material.id, material.name, "Existing project");
		for (const key of textureKeys) add(key === "envMap" ? "environment" : "texture", material[key].url, material[key].fileName, `Material: ${material.name}`);
	}
	return assets;
}

export function assetReferences(scene: VisualSceneState, asset: VisualProjectAsset): string[] {
	if (asset.kind === "material") {
		return [
			...scene.primitives.filter(item => item.materialId === asset.url).map(item => item.name),
			...scene.secondaryDynamics.filter(item => item.materialId === asset.url).map(item => item.name),
			...(scene.object.materialId === asset.url ? ["Imported object"] : []),
		];
	}
	const references: string[] = [];
	if (scene.object.modelUrl === asset.url) references.push("Imported object");
	if (scene.object.assetFiles.some(file => file.url === asset.url)) references.push("Model package");
	for (const material of scene.materials) for (const key of textureKeys) {
		if (material[key].url === asset.url) references.push(`${material.name}: ${key}`);
	}
	if (scene.postFx.lutUrl === asset.url) references.push("Post FX LUT");
	if (scene.particles.textureUrl === asset.url) references.push("Particles");
	for (const key of ["sphereUrl", "boxRightUrl", "boxLeftUrl", "boxTopUrl", "boxBottomUrl", "boxFrontUrl", "boxBackUrl"] as const) if (scene.sky[key] === asset.url) references.push(`Sky: ${key}`);
	return references;
}

export function relinkProjectAsset(scene: VisualSceneState, id: string, url: string, name: string): VisualSceneState {
	const asset = scene.projectAssets.find(item => item.id === id);
	if (!asset || asset.kind === "material") return scene;
	return {
		...scene,
		projectAssets: scene.projectAssets.map(item => item.id === id ? {...item,url,name,status:"available" as const} : item),
		object: {...scene.object,
			modelUrl: scene.object.modelUrl === asset.url ? url : scene.object.modelUrl,
			modelFileName: scene.object.modelUrl === asset.url ? name : scene.object.modelFileName,
			assetFiles: scene.object.assetFiles.map(file => file.url === asset.url ? {...file,url,fileName:name} : file),
		},
		materials: scene.materials.map(material => {
			const updated = {...material};
			for (const key of textureKeys) if (material[key].url === asset.url) updated[key] = {url,fileName:name} as VisualTextureSlot;
			return updated;
		}),
		postFx: scene.postFx.lutUrl === asset.url ? {...scene.postFx, lutUrl: url, lutFileName: name} : scene.postFx,
		particles: scene.particles.textureUrl === asset.url ? {...scene.particles, textureUrl: url, textureFileName: name} : scene.particles,
		sky: Object.fromEntries(Object.entries(scene.sky).map(([key, value]) => [key, value === asset.url ? url : value])) as VisualSceneState["sky"],
	};
}

export function deleteProjectAsset(scene: VisualSceneState, id: string): VisualSceneState {
	const asset = scene.projectAssets.find(item => item.id === id);
	if (!asset || assetReferences(scene,asset).length) return scene;
	return {...scene,projectAssets:scene.projectAssets.filter(item => item.id !== id),
		materials: asset.kind === "material" ? scene.materials.filter(material => material.id !== asset.url) : scene.materials};
}
