/**
 * exporter.js — Export utilities for PNG and Unity .unitypackage.
 * Unity 6 (6000.3.8f1) — confirmed values measured from actual project.
 *
 * Exports:
 *   exportPNG(canvas, filename)
 *   exportUnityPackage(canvas, tiles, tileSize, algorithm, name)   [async]
 *
 * ─────────────────────────────────────────────────────────────
 * Unity .unitypackage structure (gzip-compressed ustar TAR):
 *
 *   {guid}/asset      — binary or text content
 *   {guid}/asset.meta — Unity importer YAML
 *   {guid}/pathname   — project-relative path + newline
 *
 * Sprite internalID in TextureImporter = i + 1  (1-based).
 * Sprite fileID in cross-asset references = same internalID value.
 * ─────────────────────────────────────────────────────────────
 */

import { buildTar, gzip } from './tar.js';

const enc = new TextEncoder();

// ─────────────────────────────────────────────────────────────
// Unity 6 confirmed constants
// ─────────────────────────────────────────────────────────────

// com.unity.2d.tilemap.extras 6.0.1 — confirmed script GUIDs
const RULETILE_SCRIPT_GUID = '9d1514134bc4fbd41bb739b1b9a49231';

// Component class IDs measured from actual Unity 6 (6000.3.8f1) prefab
const CID_GRID            = '156049354';   // !u!156049354
const CID_TILEMAP         = '1839735485';  // !u!1839735485
const CID_TILEMAPRENDERER = '483693784';   // !u!483693784

// GridPalette = UnityEditor.dll built-in type (UnityEditor.GridPalette)
// fileID:12395 is version-independent
const GP_SCRIPT_FILEID = 12395;
const GP_SCRIPT_GUID   = '0000000000000000e000000000000000';


// RuleTile neighbor values (confirmed from working rule.asset)
const NBR_THIS    = 1;  // same tile type
const NBR_NOTTHIS = 2;  // different tile type
// 0 = don't care

// ─────────────────────────────────────────────────────────────
// PNG Export
// ─────────────────────────────────────────────────────────────

export function exportPNG(canvas, filename = 'tileset.png') {
  canvas.toBlob(blob => {
    if (!blob) { console.error('[exportPNG] toBlob returned null'); return; }
    triggerDownload(URL.createObjectURL(blob), filename);
  }, 'image/png');
}

// ─────────────────────────────────────────────────────────────
// Unity .unitypackage Export
// ─────────────────────────────────────────────────────────────

/**
 * @param {HTMLCanvasElement} canvas
 * @param {TileDescriptor[]}  tiles
 * @param {number}            tileSize
 * @param {string}            algorithm  '16' | '47'
 * @param {string}            name       user-defined tileset name
 */
export async function exportUnityPackage(canvas, tiles, tileSize, algorithm, name = 'BaconTileSet') {
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_') || 'BaconTileSet';

  const pngBlob = await canvasToBlob(canvas);
  const pngData = new Uint8Array(await pngBlob.arrayBuffer());
  const pngGuid = generateGuid();
  const pngFile = `${safeName}-${algorithm}.png`;
  const pngPath = `Assets/${safeName}/Sprites/${pngFile}`;

  // Generate sprite internalIDs upfront — must be large 64-bit numbers (Unity 6 requirement).
  // The same IDs are used in TextureImporter meta AND in all cross-asset sprite references.
  const spriteIds = tiles.map(() => randomFileId());

  const pngMeta = buildTextureMeta(pngGuid, tiles, canvas.height, tileSize, spriteIds);

  const tileEntries = buildTileAssets(tiles, pngGuid, safeName, spriteIds);

  const ruleTileGuid = generateGuid();
  const ruleTileName = `${safeName}RuleTile`;
  const ruleTilePath = `Assets/${safeName}/Tiles/${ruleTileName}.asset`;
  const ruleTileYaml = buildRuleTileAsset(tiles, pngGuid, algorithm, ruleTileName, spriteIds);

  const paletteGuid = generateGuid();
  const paletteName = `${safeName}Palette`;
  const palettePath = `Assets/${safeName}/Palettes/${paletteName}.prefab`;
  const paletteYaml = buildTilePalette(paletteName, ruleTileGuid, pngGuid, spriteIds[0]);

  const entries = [
    { name: `${pngGuid}/`,           type: '5' },
    { name: `${pngGuid}/asset`,      data: pngData },
    { name: `${pngGuid}/asset.meta`, data: enc.encode(pngMeta) },
    { name: `${pngGuid}/pathname`,   data: enc.encode(pngPath + '\n') },
  ];

  for (const te of tileEntries) {
    entries.push({ name: `${te.guid}/`,           type: '5' });
    entries.push({ name: `${te.guid}/asset`,      data: enc.encode(te.yaml) });
    entries.push({ name: `${te.guid}/asset.meta`, data: enc.encode(nativeFormatMeta(te.guid)) });
    entries.push({ name: `${te.guid}/pathname`,   data: enc.encode(te.path + '\n') });
  }

  entries.push({ name: `${ruleTileGuid}/`,           type: '5' });
  entries.push({ name: `${ruleTileGuid}/asset`,      data: enc.encode(ruleTileYaml) });
  entries.push({ name: `${ruleTileGuid}/asset.meta`, data: enc.encode(nativeFormatMeta(ruleTileGuid)) });
  entries.push({ name: `${ruleTileGuid}/pathname`,   data: enc.encode(ruleTilePath + '\n') });

  entries.push({ name: `${paletteGuid}/`,           type: '5' });
  entries.push({ name: `${paletteGuid}/asset`,      data: enc.encode(paletteYaml) });
  entries.push({ name: `${paletteGuid}/asset.meta`, data: enc.encode(prefabMeta(paletteGuid)) });
  entries.push({ name: `${paletteGuid}/pathname`,   data: enc.encode(palettePath + '\n') });

  const tarData    = buildTar(entries);
  const compressed = await gzip(tarData);
  triggerDownload(
    URL.createObjectURL(new Blob([compressed], { type: 'application/octet-stream' })),
    `${safeName}-${algorithm}.unitypackage`
  );
}

// ─────────────────────────────────────────────────────────────
// Spritesheet TextureImporter meta
// ─────────────────────────────────────────────────────────────

/**
 * Unity sprite rects use bottom-up Y:  unityY = imageH - tile.y - tile.height
 * spritePixelsToUnits = tileSize (1 tile = 1 Unity unit).
 * spriteIds[i]: pre-generated large int64 — written as internalID and in nameFileIdTable.
 *
 * serializedVersion: 13 (Unity 6 / 6000.x).
 * nameFileIdTable must be present for Unity to preserve our internalID values on import.
 */
function buildTextureMeta(guid, tiles, imageH, tileSize, spriteIds) {
  const spritesYaml = tiles.map((tile, i) => {
    const unityY = imageH - tile.y - tile.height;
    const label  = tile.label.replace(/[^a-zA-Z0-9_]/g, '_');
    return [
      `    - serializedVersion: 2`,
      `      name: ${label}`,
      `      rect:`,
      `        serializedVersion: 2`,
      `        x: ${tile.x}`,
      `        y: ${unityY}`,
      `        width: ${tile.width}`,
      `        height: ${tile.height}`,
      `      alignment: 0`,
      `      pivot: {x: 0.5, y: 0.5}`,
      `      border: {x: 0, y: 0, z: 0, w: 0}`,
      `      customData: `,
      `      outline: []`,
      `      physicsShape: []`,
      `      tessellationDetail: -1`,
      `      bones: []`,
      `      spriteID: ${generateGuid()}`,
      `      internalID: ${spriteIds[i]}`,
      `      vertices: []`,
      `      indices: `,
      `      edges: []`,
      `      weights: []`,
    ].join('\n');
  }).join('\n');

  // nameFileIdTable: required in Unity 6 to anchor sprite name → internalID mapping.
  // Without this, Unity regenerates internalIDs on import, breaking cross-asset references.
  const nameFileIdLines = tiles.map((tile, i) => {
    const label = tile.label.replace(/[^a-zA-Z0-9_]/g, '_');
    return `      ${label}: ${spriteIds[i]}`;
  }).join('\n');

  return [
    `fileFormatVersion: 2`,
    `guid: ${guid}`,
    `TextureImporter:`,
    `  internalIDToNameTable: []`,
    `  externalObjects: {}`,
    `  serializedVersion: 13`,
    `  mipmaps:`,
    `    mipMapMode: 0`,
    `    enableMipMap: 0`,
    `    sRGBTexture: 1`,
    `    linearTexture: 0`,
    `    fadeOut: 0`,
    `    borderMipMap: 0`,
    `    mipMapsPreserveCoverage: 0`,
    `    alphaTestReferenceValue: 0.5`,
    `    mipMapFadeDistanceStart: 1`,
    `    mipMapFadeDistanceEnd: 3`,
    `  bumpmap:`,
    `    convertToNormalMap: 0`,
    `    externalNormalMap: 0`,
    `    heightScale: 0.25`,
    `    normalMapFilter: 0`,
    `    flipGreenChannel: 0`,
    `  isReadable: 0`,
    `  streamingMipmaps: 0`,
    `  streamingMipmapsPriority: 0`,
    `  vTOnly: 0`,
    `  ignoreMipmapLimit: 0`,
    `  grayScaleToAlpha: 0`,
    `  generateCubemap: 6`,
    `  cubemapConvolution: 0`,
    `  seamlessCubemap: 0`,
    `  textureFormat: 1`,
    `  maxTextureSize: 2048`,
    `  textureSettings:`,
    `    serializedVersion: 2`,
    `    filterMode: 0`,
    `    aniso: 1`,
    `    mipBias: 0`,
    `    wrapU: 0`,
    `    wrapV: 0`,
    `    wrapW: 0`,
    `  nPOTScale: 0`,
    `  lightmap: 0`,
    `  compressionQuality: 50`,
    `  spriteMode: 2`,
    `  spriteExtrude: 1`,
    `  spriteMeshType: 1`,
    `  alignment: 0`,
    `  spritePivot: {x: 0.5, y: 0.5}`,
    `  spritePixelsToUnits: ${tileSize}`,
    `  spriteBorder: {x: 0, y: 0, z: 0, w: 0}`,
    `  spriteGenerateFallbackPhysicsShape: 1`,
    `  alphaUsage: 1`,
    `  alphaIsTransparency: 1`,
    `  spriteTessellationDetail: -1`,
    `  textureType: 8`,
    `  textureShape: 1`,
    `  singleChannelComponent: 0`,
    `  flipbookRows: 1`,
    `  flipbookColumns: 1`,
    `  maxTextureSizeSet: 0`,
    `  compressionQualitySet: 0`,
    `  textureFormatSet: 0`,
    `  ignorePngGamma: 0`,
    `  applyGammaDecoding: 0`,
    `  swizzle: 50462976`,
    `  cookieLightType: 0`,
    `  platformSettings:`,
    `  - serializedVersion: 4`,
    `    buildTarget: DefaultTexturePlatform`,
    `    maxTextureSize: 2048`,
    `    resizeAlgorithm: 0`,
    `    textureFormat: -1`,
    `    textureCompression: 1`,
    `    compressionQuality: 50`,
    `    crunchedCompression: 0`,
    `    allowsAlphaSplitting: 0`,
    `    overridden: 0`,
    `    ignorePlatformSupport: 0`,
    `    androidETC2FallbackOverride: 0`,
    `    forceMaximumCompressionQuality_BC6H_BC7: 0`,
    `  spriteSheet:`,
    `    serializedVersion: 2`,
    `    sprites:`,
    spritesYaml,
    `    outline: []`,
    `    customData: `,
    `    physicsShape: []`,
    `    bones: []`,
    `    spriteID: `,
    `    internalID: 0`,
    `    vertices: []`,
    `    indices: `,
    `    edges: []`,
    `    weights: []`,
    `    secondaryTextures: []`,
    `    spriteCustomMetadata:`,
    `      entries: []`,
    `    nameFileIdTable:`,
    nameFileIdLines,
    `  mipmapLimitGroupName: `,
    `  pSDRemoveMatte: 0`,
    `userData: `,
    `assetBundleName: `,
    `assetBundleVariant: `,
    ``,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Individual Tile assets (Unity built-in Tile class)
// ─────────────────────────────────────────────────────────────

/**
 * One Tile .asset per sprite.
 * Built-in Tile class: fileID:13312, guid:000...e000..., type:0
 * Sprite referenced by internalID (= tile.id + 1) as fileID.
 *
 * @returns {{ guid, path, yaml }[]}
 */
function buildTileAssets(tiles, textureGuid, safeName, spriteIds) {
  return tiles.map((tile, i) => {
    const guid         = generateGuid();
    const label        = tile.label.replace(/[^a-zA-Z0-9_]/g, '_');
    const path         = `Assets/${safeName}/Tiles/${label}.asset`;
    const spriteFileId = spriteIds[i];  // matches internalID in TextureImporter

    const yaml = [
      `%YAML 1.1`,
      `%TAG !u! tag:unity3d.com,2011:`,
      `--- !u!114 &11400000`,
      `MonoBehaviour:`,
      `  m_ObjectHideFlags: 0`,
      `  m_CorrespondingSourceObject: {fileID: 0}`,
      `  m_PrefabInstance: {fileID: 0}`,
      `  m_PrefabAsset: {fileID: 0}`,
      `  m_GameObject: {fileID: 0}`,
      `  m_Enabled: 1`,
      `  m_EditorHideFlags: 0`,
      `  m_Script: {fileID: 13312, guid: 0000000000000000e000000000000000, type: 0}`,
      `  m_Name: ${label}`,
      `  m_EditorClassIdentifier: UnityEngine.dll::UnityEngine.Tilemaps.Tile`,
      `  m_Sprite: {fileID: ${spriteFileId}, guid: ${textureGuid}, type: 3}`,
      `  m_Color: {r: 1, g: 1, b: 1, a: 1}`,
      `  m_Transform:`,
      `    e00: 1`,
      `    e01: 0`,
      `    e02: 0`,
      `    e03: 0`,
      `    e10: 0`,
      `    e11: 1`,
      `    e12: 0`,
      `    e13: 0`,
      `    e20: 0`,
      `    e21: 0`,
      `    e22: 1`,
      `    e23: 0`,
      `    e30: 0`,
      `    e31: 0`,
      `    e32: 0`,
      `    e33: 1`,
      `  m_InstancedGameObject: {fileID: 0}`,
      `  m_Flags: 1`,
      `  m_ColliderType: 1`,
      ``,
    ].join('\n');

    return { guid, path, yaml };
  });
}

// ─────────────────────────────────────────────────────────────
// RuleTile asset (com.unity.2d.tilemap.extras 6.0.1)
// ─────────────────────────────────────────────────────────────

/**
 * Builds a RuleTile .asset.
 * Script GUID: 9d1514134bc4fbd41bb739b1b9a49231
 * (stable across Unity 2020–Unity 6)
 */
function buildRuleTileAsset(tiles, textureGuid, algorithm, assetName, spriteIds) {
  const rulesYaml = tiles.map((tile, i) => buildRuleEntry(tile, textureGuid, algorithm, spriteIds[i])).join('\n');

  return [
    `%YAML 1.1`,
    `%TAG !u! tag:unity3d.com,2011:`,
    `--- !u!114 &11400000`,
    `MonoBehaviour:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: 0}`,
    `  m_Enabled: 1`,
    `  m_EditorHideFlags: 0`,
    `  m_Script: {fileID: 11500000, guid: ${RULETILE_SCRIPT_GUID}, type: 3}`,
    `  m_Name: ${assetName}`,
    `  m_EditorClassIdentifier: `,
    `  m_DefaultSprite: {fileID: ${spriteIds[0]}, guid: ${textureGuid}, type: 3}`,
    `  m_DefaultColliderType: 1`,
    `  m_TilingRules:`,
    rulesYaml,
    ``,
  ].join('\n');
}

/**
 * One tiling-rule entry for a single tile.
 *
 * m_Neighbors: hex-encoded string of 8 int32-LE values, always all 8 directions (NW,N,NE,W,E,SW,S,SE).
 * Values: 0=don't care, 1=This (NBR_THIS), 2=NotThis (NBR_NOTTHIS).
 * Confirmed format from working rule.asset — no m_Id, no m_NeighborPositions, no m_GameObject.
 *
 * For 16-tile: cardinals only (diagonals = 0/don't care)
 * For 47-tile: all 8; diagonal = This if set, NotThis if inner-corner, else don't care
 */
function buildRuleEntry(tile, textureGuid, algorithm, spriteFileId) {

  let nbrValues;  // [NW, N, NE, W, E, SW, S, SE]; 0 = don't care

  if (algorithm === '47') {
    const b     = tile.bitmask8 !== undefined ? tile.bitmask8 : 0;
    const hasN  = !!(b & 0x01);
    const hasNE = !!(b & 0x02);
    const hasE  = !!(b & 0x04);
    const hasSE = !!(b & 0x08);
    const hasS  = !!(b & 0x10);
    const hasSW = !!(b & 0x20);
    const hasW  = !!(b & 0x40);
    const hasNW = !!(b & 0x80);

    // Diagonal: This if present; NotThis only when both adjacent cardinals present (inner corner); else don't care
    const nw = hasNW ? NBR_THIS : (hasN && hasW ? NBR_NOTTHIS : 0);
    const ne = hasNE ? NBR_THIS : (hasN && hasE ? NBR_NOTTHIS : 0);
    const sw = hasSW ? NBR_THIS : (hasS && hasW ? NBR_NOTTHIS : 0);
    const se = hasSE ? NBR_THIS : (hasS && hasE ? NBR_NOTTHIS : 0);

    nbrValues = [
      nw,
      hasN ? NBR_THIS : NBR_NOTTHIS,
      ne,
      hasW ? NBR_THIS : NBR_NOTTHIS,
      hasE ? NBR_THIS : NBR_NOTTHIS,
      sw,
      hasS ? NBR_THIS : NBR_NOTTHIS,
      se,
    ];
  } else {
    // 16-tile: 4-bit cardinal bitmask (bit0=N, bit1=E, bit2=S, bit3=W)
    const b    = tile.bitmask !== undefined ? tile.bitmask : 0;
    const hasN = !!(b & 0x1);
    const hasE = !!(b & 0x2);
    const hasS = !!(b & 0x4);
    const hasW = !!(b & 0x8);

    nbrValues = [
      0,                             // NW: don't care
      hasN ? NBR_THIS : NBR_NOTTHIS, // N
      0,                             // NE: don't care
      hasW ? NBR_THIS : NBR_NOTTHIS, // W
      hasE ? NBR_THIS : NBR_NOTTHIS, // E
      0,                             // SW: don't care
      hasS ? NBR_THIS : NBR_NOTTHIS, // S
      0,                             // SE: don't care
    ];
  }

  // Encode m_Neighbors as hex: 8 × int32-LE (4 bytes each = 8 hex chars each → 64 chars total)
  // e.g. value 0 → '00000000', value 1 → '01000000', value 2 → '02000000'
  const neighborsHex = nbrValues
    .map(v => v.toString(16).padStart(2, '0') + '000000')
    .join('');

  return [
    `  - m_Neighbors: ${neighborsHex}`,
    `    m_Sprites:`,
    `    - {fileID: ${spriteFileId}, guid: ${textureGuid}, type: 3}`,
    `    m_AnimationSpeed: 1`,
    `    m_PerlinScale: 0.5`,
    `    m_RuleTransform: 0`,
    `    m_Output: 0`,
    `    m_ColliderType: 1`,
    `    m_RandomTransform: 0`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// TilePalette prefab — Unity 6 confirmed structure
// ─────────────────────────────────────────────────────────────

/**
 * Generates an empty TilePalette prefab with Unity 6 confirmed class IDs.
 *
 * Document order (matches actual Unity 6 output):
 *   1. Layer1 GameObject  (!u!1)
 *   2. Layer1 Transform   (!u!4)
 *   3. Tilemap            (!u!1839735485)
 *   4. TilemapRenderer    (!u!483693784)
 *   5. Root GameObject    (!u!1)
 *   6. Root Transform     (!u!4)
 *   7. Grid               (!u!156049354)
 *   8. GridPalette        (!u!114, m_GameObject:{fileID:0} — sub-asset)
 *
 * GridPalette script: fileID:12395, guid:000...e000..., type:0
 *   UnityEditor.dll built-in — version-independent.
 */
function buildTilePalette(paletteName, ruleTileGuid, textureGuid, spriteId0) {
  const layerGoId     = randomFileId();
  const layerTransId  = randomFileId();
  const tilemapId     = randomFileId();
  const tilemapRendId = randomFileId();
  const rootGoId      = randomFileId();
  const rootTransId   = randomFileId();
  const gridId        = randomFileId();
  const gridPaletteId = randomFileId();

  return [
    `%YAML 1.1`,
    `%TAG !u! tag:unity3d.com,2011:`,

    // ── Layer1 GameObject ─────────────────────────────────────
    `--- !u!1 &${layerGoId}`,
    `GameObject:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  serializedVersion: 6`,
    `  m_Component:`,
    `  - component: {fileID: ${layerTransId}}`,
    `  - component: {fileID: ${tilemapId}}`,
    `  - component: {fileID: ${tilemapRendId}}`,
    `  m_Layer: 0`,
    `  m_Name: Layer1`,
    `  m_TagString: Untagged`,
    `  m_Icon: {fileID: 0}`,
    `  m_NavMeshLayer: 0`,
    `  m_StaticEditorFlags: 0`,
    `  m_IsActive: 1`,

    // ── Layer1 Transform ──────────────────────────────────────
    `--- !u!4 &${layerTransId}`,
    `Transform:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: ${layerGoId}}`,
    `  serializedVersion: 2`,
    `  m_LocalRotation: {x: -0, y: -0, z: -0, w: 1}`,
    `  m_LocalPosition: {x: 0, y: 0, z: 0}`,
    `  m_LocalScale: {x: 1, y: 1, z: 1}`,
    `  m_ConstrainProportionsScale: 0`,
    `  m_Children: []`,
    `  m_Father: {fileID: ${rootTransId}}`,
    `  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}`,

    // ── Tilemap ───────────────────────────────────────────────
    `--- !u!${CID_TILEMAP} &${tilemapId}`,
    `Tilemap:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: ${layerGoId}}`,
    `  m_Enabled: 1`,
    `  m_Tiles:`,
    `  - first: {x: 0, y: 0, z: 0}`,
    `    second:`,
    `      m_TileIndex: 0`,
    `      m_TileSpriteIndex: 0`,
    `      m_TileMatrixIndex: 0`,
    `      m_TileColorIndex: 0`,
    `      m_ObjectToInstantiate: {fileID: 0}`,
    `      m_TileFlags: 2`,
    `      m_ColliderType: 1`,
    `  m_AnimatedTiles: {}`,
    `  m_TileAssetArray:`,
    `  - m_RefCount: 1`,
    `    m_Data: {fileID: 11400000, guid: ${ruleTileGuid}, type: 2}`,
    `  m_TileSpriteArray:`,
    `  - m_RefCount: 1`,
    `    m_Data: {fileID: ${spriteId0}, guid: ${textureGuid}, type: 3}`,
    `  m_TileMatrixArray:`,
    `  - m_RefCount: 1`,
    `    m_Data:`,
    `      e00: 1`,
    `      e01: 0`,
    `      e02: 0`,
    `      e03: 0`,
    `      e10: 0`,
    `      e11: 1`,
    `      e12: 0`,
    `      e13: 0`,
    `      e20: 0`,
    `      e21: 0`,
    `      e22: 1`,
    `      e23: 0`,
    `      e30: 0`,
    `      e31: 0`,
    `      e32: 0`,
    `      e33: 1`,
    `  m_TileColorArray:`,
    `  - m_RefCount: 1`,
    `    m_Data: {r: 1, g: 1, b: 1, a: 1}`,
    `  m_TileObjectToInstantiateArray: []`,
    `  m_AnimationFrameRate: 1`,
    `  m_Color: {r: 1, g: 1, b: 1, a: 1}`,
    `  m_Origin: {x: 0, y: 0, z: 0}`,
    `  m_Size: {x: 1, y: 1, z: 1}`,
    `  m_TileAnchor: {x: 0.5, y: 0.5, z: 0}`,
    `  m_TileOrientation: 0`,
    `  m_TileOrientationMatrix:`,
    `    e00: 1`,
    `    e01: 0`,
    `    e02: 0`,
    `    e03: 0`,
    `    e10: 0`,
    `    e11: 1`,
    `    e12: 0`,
    `    e13: 0`,
    `    e20: 0`,
    `    e21: 0`,
    `    e22: 1`,
    `    e23: 0`,
    `    e30: 0`,
    `    e31: 0`,
    `    e32: 0`,
    `    e33: 1`,

    // ── TilemapRenderer ───────────────────────────────────────
    `--- !u!${CID_TILEMAPRENDERER} &${tilemapRendId}`,
    `TilemapRenderer:`,
    `  serializedVersion: 2`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: ${layerGoId}}`,
    `  m_Enabled: 0`,
    `  m_CastShadows: 0`,
    `  m_ReceiveShadows: 0`,
    `  m_DynamicOccludee: 1`,
    `  m_StaticShadowCaster: 0`,
    `  m_MotionVectors: 1`,
    `  m_LightProbeUsage: 0`,
    `  m_ReflectionProbeUsage: 0`,
    `  m_RayTracingMode: 0`,
    `  m_RayTraceProcedural: 0`,
    `  m_RayTracingAccelStructBuildFlagsOverride: 0`,
    `  m_RayTracingAccelStructBuildFlags: 1`,
    `  m_SmallMeshCulling: 1`,
    `  m_ForceMeshLod: -1`,
    `  m_MeshLodSelectionBias: 0`,
    `  m_RenderingLayerMask: 1`,
    `  m_RendererPriority: 0`,
    `  m_Materials:`,
    `  - {fileID: 10754, guid: 0000000000000000f000000000000000, type: 0}`,
    `  m_StaticBatchInfo:`,
    `    firstSubMesh: 0`,
    `    subMeshCount: 0`,
    `  m_StaticBatchRoot: {fileID: 0}`,
    `  m_ProbeAnchor: {fileID: 0}`,
    `  m_LightProbeVolumeOverride: {fileID: 0}`,
    `  m_ScaleInLightmap: 1`,
    `  m_ReceiveGI: 1`,
    `  m_PreserveUVs: 0`,
    `  m_IgnoreNormalsForChartDetection: 0`,
    `  m_ImportantGI: 0`,
    `  m_StitchLightmapSeams: 1`,
    `  m_SelectedEditorRenderState: 0`,
    `  m_MinimumChartSize: 4`,
    `  m_AutoUVMaxDistance: 0.5`,
    `  m_AutoUVMaxAngle: 89`,
    `  m_LightmapParameters: {fileID: 0}`,
    `  m_GlobalIlluminationMeshLod: 0`,
    `  m_SortingLayerID: 0`,
    `  m_SortingLayer: 0`,
    `  m_SortingOrder: 0`,
    `  m_MaskInteraction: 0`,
    `  m_ChunkSize: {x: 32, y: 32, z: 32}`,
    `  m_ChunkCullingBounds: {x: 0, y: 0, z: 0}`,
    `  m_MaxChunkCount: 16`,
    `  m_MaxFrameAge: 16`,
    `  m_SortOrder: 0`,
    `  m_Mode: 0`,
    `  m_DetectChunkCullingBounds: 0`,

    // ── Root GameObject ───────────────────────────────────────
    `--- !u!1 &${rootGoId}`,
    `GameObject:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  serializedVersion: 6`,
    `  m_Component:`,
    `  - component: {fileID: ${rootTransId}}`,
    `  - component: {fileID: ${gridId}}`,
    `  m_Layer: 0`,
    `  m_Name: ${paletteName}`,
    `  m_TagString: Untagged`,
    `  m_Icon: {fileID: 0}`,
    `  m_NavMeshLayer: 0`,
    `  m_StaticEditorFlags: 0`,
    `  m_IsActive: 1`,

    // ── Root Transform ────────────────────────────────────────
    `--- !u!4 &${rootTransId}`,
    `Transform:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: ${rootGoId}}`,
    `  serializedVersion: 2`,
    `  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}`,
    `  m_LocalPosition: {x: 0, y: 0, z: 0}`,
    `  m_LocalScale: {x: 1, y: 1, z: 1}`,
    `  m_ConstrainProportionsScale: 0`,
    `  m_Children:`,
    `  - {fileID: ${layerTransId}}`,
    `  m_Father: {fileID: 0}`,
    `  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}`,

    // ── Grid component ────────────────────────────────────────
    `--- !u!${CID_GRID} &${gridId}`,
    `Grid:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: ${rootGoId}}`,
    `  m_Enabled: 1`,
    `  m_CellSize: {x: 1, y: 1, z: 0}`,
    `  m_CellGap: {x: 0, y: 0, z: 0}`,
    `  m_CellLayout: 0`,
    `  m_CellSwizzle: 0`,

    // ── GridPalette MonoBehaviour (sub-asset — no parent GameObject) ──
    // m_Script: built-in UnityEditor.GridPalette (version-independent)
    `--- !u!114 &${gridPaletteId}`,
    `MonoBehaviour:`,
    `  m_ObjectHideFlags: 0`,
    `  m_CorrespondingSourceObject: {fileID: 0}`,
    `  m_PrefabInstance: {fileID: 0}`,
    `  m_PrefabAsset: {fileID: 0}`,
    `  m_GameObject: {fileID: 0}`,
    `  m_Enabled: 1`,
    `  m_EditorHideFlags: 0`,
    `  m_Script: {fileID: ${GP_SCRIPT_FILEID}, guid: ${GP_SCRIPT_GUID}, type: 0}`,
    `  m_Name: Palette Settings`,
    `  m_EditorClassIdentifier: UnityEditor.dll::UnityEditor.GridPalette`,
    `  cellSizing: 0`,
    `  m_TransparencySortMode: 0`,
    `  m_TransparencySortAxis: {x: 0, y: 0, z: 1}`,
    ``,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Meta file generators
// ─────────────────────────────────────────────────────────────

function nativeFormatMeta(guid) {
  return [
    `fileFormatVersion: 2`,
    `guid: ${guid}`,
    `NativeFormatImporter:`,
    `  externalObjects: {}`,
    `  mainObjectFileID: 11400000`,
    `  userData: `,
    `  assetBundleName: `,
    `  assetBundleVariant: `,
    ``,
  ].join('\n');
}

function prefabMeta(guid) {
  return [
    `fileFormatVersion: 2`,
    `guid: ${guid}`,
    `PrefabImporter:`,
    `  externalObjects: {}`,
    `  userData: `,
    `  assetBundleName: `,
    `  assetBundleVariant: `,
    ``,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────


function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('toBlob returned null')),
      'image/png'
    );
  });
}

/** Generate a 32-char hex GUID. Prefers crypto.randomUUID() when available. */
function generateGuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** Random positive int64 string for Unity prefab fileIDs. */
function randomFileId() {
  const hi = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
  const lo  = Math.floor(Math.random() * 0x100000000);
  return String(BigInt(hi) * BigInt(0x100000000) + BigInt(lo));
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
