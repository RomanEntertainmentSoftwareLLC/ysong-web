import type { VisualSceneState } from "./visualsScene";

export type VisualTransformMode = "translate" | "rotate" | "scale";
export type VisualTransformSpace = "world" | "local";
export type VisualTransform = {
	positionX: number; positionY: number; positionZ: number;
	rotationX: number; rotationY: number; rotationZ: number;
	scaleX: number; scaleY: number; scaleZ: number;
};

export function selectedVisualTransform(scene: VisualSceneState, id: string): VisualTransform | null {
	const layer = scene.layers.find(item => item.id === id);
	if (!layer || layer.locked || !layer.visible) return null;
	const source = layer.type === "primitive"
		? scene.primitives.find(item => item.id === layer.entityId)
		: layer.type === "object" ? scene.object : null;
	if (!source || ("visible" in source && !source.visible)) return null;
	const scale = "baseScale" in source ? source.baseScale : 1;
	return {
		positionX: source.positionX, positionY: source.positionY, positionZ: source.positionZ,
		rotationX: source.rotationX, rotationY: source.rotationY, rotationZ: source.rotationZ,
		scaleX: "scaleX" in source ? source.scaleX : scale,
		scaleY: "scaleY" in source ? source.scaleY : scale,
		scaleZ: "scaleZ" in source ? source.scaleZ : scale,
	};
}

export function applyVisualTransform(scene: VisualSceneState, id: string, transform: VisualTransform): VisualSceneState {
	const layer = scene.layers.find(item => item.id === id);
	if (!layer || layer.locked || !layer.visible) return scene;
	if (!Object.values(transform).every(Number.isFinite)) return scene;
	const scale = (value: number) => Math.max(0.001, Math.min(100, value));
	const position = { positionX: transform.positionX, positionY: transform.positionY, positionZ: transform.positionZ };
	const rotation = { rotationX: transform.rotationX, rotationY: transform.rotationY, rotationZ: transform.rotationZ };
	if (layer.type === "primitive") return {
		...scene, primitives: scene.primitives.map(item => item.id === layer.entityId
			? { ...item, ...position, ...rotation, scaleX: scale(transform.scaleX), scaleY: scale(transform.scaleY), scaleZ: scale(transform.scaleZ) }
			: item),
	};
	if (layer.type === "object") return {
		...scene, object: { ...scene.object, ...position, ...rotation, baseScale: scale(transform.scaleX) },
	};
	return scene;
}
