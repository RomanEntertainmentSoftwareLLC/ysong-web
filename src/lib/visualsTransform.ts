import type { VisualSceneState } from "./visualsScene";
import * as THREE from "three";
import { primitiveWorldMatrix } from "./visualsHierarchy.ts";

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
	if (layer.type === "primitive" && "parentId" in source && source.parentId) {
		const world = primitiveWorldMatrix(scene.primitives, source.id);
		if (!world) return null;
		const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
		world.decompose(position, rotation, scale);
		const euler = new THREE.Euler().setFromQuaternion(rotation);
		return {positionX:position.x,positionY:position.y,positionZ:position.z,rotationX:euler.x,rotationY:euler.y,rotationZ:euler.z,scaleX:scale.x,scaleY:scale.y,scaleZ:scale.z};
	}
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
	if (layer.type === "primitive") {
		const child = scene.primitives.find(item => item.id === layer.entityId);
		if (child?.parentId) {
			const parent = primitiveWorldMatrix(scene.primitives, child.parentId);
			if (!parent) return scene;
			const desired = new THREE.Matrix4().compose(new THREE.Vector3(transform.positionX, transform.positionY, transform.positionZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(transform.rotationX, transform.rotationY, transform.rotationZ)), new THREE.Vector3(transform.scaleX, transform.scaleY, transform.scaleZ));
			const local = parent.invert().multiply(desired);
			const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
			local.decompose(p, q, s);
			const e = new THREE.Euler().setFromQuaternion(q);
			return {...scene, primitives:scene.primitives.map(item => item.id === child.id ? {...item,positionX:p.x,positionY:p.y,positionZ:p.z,rotationX:e.x,rotationY:e.y,rotationZ:e.z,scaleX:scale(s.x),scaleY:scale(s.y),scaleZ:scale(s.z)} : item)};
		}
	}
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

