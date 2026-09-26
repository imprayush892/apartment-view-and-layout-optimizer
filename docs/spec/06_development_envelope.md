# 06 — Development Envelope (user-supplied limits)

**Scope decision:** statutory regulations (DCPR 2034, NBC, CRZ, heritage, airport height, etc.)
are **not** modelled. They are complex and site-specific, and a partial encoding would produce
unrealistic or unviable designs. The design team resolves them outside the tool and passes in
the outcome.

## Inputs the tool asks for

| Input | Required | Notes |
|---|---|---|
| Total consumable FSI area (m² or ft²) | yes | Hard cap on saleable gross floor area (`ENV-FSI-01`). |
| Maximum height (m) | yes | No built-in default cap; 150 m+ towers are normal. |
| Buildable envelope | yes | Polygon the tower plates must stay inside. |
| Reserved / non-saleable floors | optional | Amenity, services, etc. |
| Podium | optional | Floors and footprint. |

## Envelope workflow (DXF or drawn)

```
upload DXF / draw polygon
        │
        ▼
tool shows the parsed closed outline
        │
  "Is this the buildable envelope?"
        │
   ┌────┴─────┐
  yes         no
   │           │
   │     tool highlights each boundary edge (E0, E1, …)
   │     user clicks an edge → enters setback (m); repeat
   │     edges without input default to 0 m
   │           │
   │     envelope = boundary offset inward per edge
   │     (half-plane intersection; see geometry/site.py)
   │           │
   └────┬──────┘
        ▼
tool shows envelope area & asks for confirmation
```

The per-edge offset is computed as the intersection of the boundary polygon with the inner
half-plane of each edge shifted inward by its setback. This is exact for convex plots and
correct for non-convex plots when setbacks are smaller than the local feature size; the tool
shows the result for the user to confirm, and warns if the envelope is empty or multipart.

In the CLI / config this is:

```yaml
site:
  boundary_is_envelope: false
  edge_setbacks_m: [9.0, 6.0, 6.0, 12.0]   # one per boundary edge, in boundary vertex order
limits:
  max_fsi_area_m2: 32000
  max_height_m: 180
```
