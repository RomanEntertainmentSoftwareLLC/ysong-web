import type { VisualMaterialAsset, VisualSceneState } from "./visualsScene";

export type MaterialTextureKey = keyof Pick<VisualMaterialAsset,
	"baseColorMap" | "normalMap" | "bumpMap" | "roughnessMap" | "metalnessMap" |
	"aoMap" | "emissiveMap" | "alphaMap" | "displacementMap" | "envMap">;

export function applyVisualMaterialUpload(
	current: VisualSceneState,
	materialId: string,
	key: MaterialTextureKey,
	url: string,
	fileName: string,
): VisualSceneState {
	if (!current.materials.some((material) => material.id === materialId)) return current;
	const imported = current.object.model === "asset" || current.object.model === "glb";
	return {
		...current,
		updatedAt: Date.now(),
		materials: current.materials.map((material) => material.id === materialId
			? { ...material, [key]: { url, fileName } } : material),
		object: imported && !current.object.materialId
			? { ...current.object, materialId } : current.object,
	};
}

export function clearVisualMaterialTexture(
	current: VisualSceneState,
	materialId: string,
	key: MaterialTextureKey,
): VisualSceneState {
	if (!current.materials.some((material) => material.id === materialId)) return current;
	return {
		...current,
		updatedAt: Date.now(),
		materials: current.materials.map((material) => material.id === materialId
			? { ...material, [key]: { url: "", fileName: "" } } : material),
	};
}

export function isCurrentVisualMaterialTexture(
	scene: VisualSceneState,
	materialId: string,
	key: MaterialTextureKey,
	url: string,
): boolean {
	return scene.materials.find((material) => material.id === materialId)?.[key].url === url;
}

export function createVisualMaterialUploadTracker() {
	const versions = new Map<string, number>();
	return (materialId: string, key: MaterialTextureKey) => {
		const slot = `${materialId}:${key}`;
		const version = (versions.get(slot) ?? 0) + 1;
		versions.set(slot, version);
		return () => versions.get(slot) === version;
	};
}
