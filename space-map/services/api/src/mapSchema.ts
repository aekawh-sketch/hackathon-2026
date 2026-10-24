// Схема документа карты (ТЗ 10.2, контракт 12.2) для серверной проверки. Совпадает с типами map-core.
// Лимиты защищают от гигантских документов: сервер не должен падать от чужого JSON.
import { Type, type Static } from '@sinclair/typebox';

const Id = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_.:-]+$' });
const Name = Type.String({ maxLength: 200 });
const Num = Type.Number({ minimum: -1e6, maximum: 1e6 });
const Vec2 = Type.Tuple([Num, Num]);
const Polygon = Type.Array(Vec2, { minItems: 3, maxItems: 500 });
const Status = Type.Union([Type.Literal('suggested'), Type.Literal('accepted')]);

const UnitKind = Type.Union(
  ['room', 'corridor', 'hall', 'lobby', 'stairs', 'elevator', 'restroom', 'service', 'outdoor'].map((k) => Type.Literal(k)),
);

export const MapDocumentSchema = Type.Object(
  {
    schema: Type.Literal(2),
    venue: Type.Object({
      id: Type.String({ maxLength: 64 }),
      name: Name,
      planNorth: Type.Union([Num, Type.Null()]),
      scaleClass: Type.Union([Type.Literal('scaled'), Type.Literal('schematic')]),
    }),
    categories: Type.Array(
      Type.Object({ id: Id, name: Name, icon: Type.String({ maxLength: 32 }), color: Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' }), synonyms: Type.Array(Name, { maxItems: 30 }) }),
      { maxItems: 100 },
    ),
    levels: Type.Array(
      Type.Object({
        id: Id,
        name: Name,
        ordinal: Type.Integer({ minimum: -20, maximum: 200 }),
        underlay: Type.Union([
          Type.Null(),
          Type.Object({ asset: Id, pxPerM: Type.Number({ exclusiveMinimum: 0, maximum: 1e4 }), origin: Vec2, rotation: Num, opacity: Type.Number({ minimum: 0, maximum: 1 }) }),
        ]),
      }),
      { minItems: 1, maxItems: 20 },
    ),
    units: Type.Array(
      Type.Object({ id: Id, level: Id, kind: UnitKind, name: Name, walkable: Type.Boolean(), polygon: Polygon, parent: Type.Optional(Id), holes: Type.Optional(Type.Array(Polygon, { maxItems: 100 })) }),
      { maxItems: 3000 },
    ),
    obstacles: Type.Array(
      Type.Object({ id: Id, level: Id, kind: Type.Union(['booth', 'column', 'counter', 'other'].map((k) => Type.Literal(k))), polygon: Polygon }),
      { maxItems: 3000 },
    ),
    openings: Type.Array(
      Type.Object({
        id: Id,
        level: Id,
        kind: Type.Union(['door', 'passage', 'entrance'].map((k) => Type.Literal(k))),
        segment: Type.Tuple([Vec2, Vec2]),
        units: Type.Union([Type.Tuple([Id, Id]), Type.Tuple([Id])]),
        door: Type.Optional(
          Type.Object({
            leaves: Type.Union([Type.Literal(1), Type.Literal(2)]),
            swing: Type.Union([Type.Literal(1), Type.Literal(-1)]),
            hinge: Type.Union([Type.Literal('start'), Type.Literal('end')]),
            openAngle: Type.Number({ minimum: 0, maximum: 180 }),
          }),
        ),
      }),
      { maxItems: 5000 },
    ),
    graph: Type.Object({
      nodes: Type.Array(Type.Object({ id: Id, level: Id, pos: Vec2, origin: Type.Union([Type.Literal('manual'), Type.Literal('auto')]) }), { maxItems: 20000 }),
      edges: Type.Array(
        Type.Object({
          id: Id,
          from: Id,
          to: Id,
          weight: Type.Number({ exclusiveMinimum: 0, maximum: 1e5 }),
          access: Type.Union(['public', 'staff', 'blocked'].map((k) => Type.Literal(k))),
        }),
        { maxItems: 60000 },
      ),
    }),
    places: Type.Array(
      Type.Object({
        id: Id,
        level: Id,
        pos: Vec2,
        node: Type.Union([Id, Type.Null()]),
        polygon: Type.Union([Polygon, Type.Null()]),
        name: Name,
        category: Id,
        number: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
        description: Type.String({ maxLength: 4000 }),
        photos: Type.Array(Id, { maxItems: 5 }),
        hours: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
        hidden: Type.Boolean(),
      }),
      { maxItems: 5000 },
    ),
    panoramas: Type.Array(
      Type.Object({
        id: Id,
        pano: Id,
        level: Id,
        pos: Vec2,
        node: Type.Union([Id, Type.Null()]),
        heading: Type.Union([Num, Type.Null()]),
        cameraHeight: Type.Number({ minimum: 0.2, maximum: 10 }),
        markers: Type.Array(Type.Object({ place: Id, yaw: Num, pitch: Num, status: Status }), { maxItems: 500 }),
        customMarkers: Type.Array(
          Type.Object({ id: Id, yaw: Num, pitch: Num, title: Name, text: Type.String({ maxLength: 4000 }) }),
          { maxItems: 200 },
        ),
        links: Type.Array(Type.Object({ to: Id, yaw: Num, status: Status }), { maxItems: 50 }),
      }),
      { maxItems: 300 },
    ),
    anchors: Type.Array(Type.Object({ id: Id, level: Id, pos: Vec2, facing: Num, code: Type.String({ pattern: '^[A-Za-z0-9_-]{1,32}$' }) }), { maxItems: 500 }),
    settings: Type.Object({ markerRange: Type.Number({ minimum: 1, maximum: 200 }), linkRange: Type.Number({ minimum: 1, maximum: 200 }) }),
    capturePoints: Type.Optional(
      Type.Array(
        Type.Object({
          id: Id,
          level: Id,
          pos: Vec2,
          origin: Type.Union([Type.Literal('auto'), Type.Literal('manual'), Type.Literal('removed')]),
          panorama: Type.Union([Id, Type.Null()]),
        }),
        { maxItems: 2000 },
      ),
    ),
  },
  { additionalProperties: false },
);

export type MapDocumentInput = Static<typeof MapDocumentSchema>;
