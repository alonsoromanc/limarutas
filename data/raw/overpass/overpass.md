# Metropolitano

```json
[out:json][timeout:50];
rel["route"="bus"]["network"="Metropolitano"]["ref"~"^(A|B|C|D)$"];
(._;>;);
out geom;
```

# Corredores

```json

[out:json][timeout:180];
{{geocodeArea:Lima}}->.a;
(
  rel["route"="bus"]["network"="SIT"]["name"~"^Corredor\\s+(Azul|Rojo|Morado|Amarillo|Verde)",i](area.a);
  rel["route"="bus"]["network"="SIT"]["name"~"^X-(CR|EM|EO|IM|IO|OM|NM|NO)",i](area.a);
);
(._;>;);
out geom;
```

# Alimentadores

```json
[out:json][timeout:240];
{{geocodeArea:Lima}}->.a;

/* Alimentadores AN/AS (dos filtros equivalentes) */
(
  rel(area.a)["route"="bus"]["ref"~"^(AN|AS)-"];
  rel(area.a)["route"="bus"]["network"~"(?i)(Metropolitano|SIT)"]["name"~"^Alimentador(a)?",i];
)->.r;

/* 1) Saca las RELATIONS con su lista de members (roles) */
.r out body;

/* 2) Trae TODOS sus miembros: ways + nodes (paraderos) */
( .r; >; );

 /* 3) Devuelve geometría completa para ways y lat/lon para nodes */
out body geom;
```
# Metro

```json
[out:json][timeout:300];
(
  rel["type"="route"]["route"~"^(subway|light_rail)$"]["network"~"Metro\\s*de\\s*Lima",i](-12.35,-77.20,-11.85,-76.75);
  rel["type"="route"]["route"~"^(subway|light_rail)$"]["name"~"(Metro\\s*de\\s*Lima|L(í|i)nea\\s*\\d+|L\\s*\\d+)",i](-12.35,-77.20,-11.85,-76.75);
  rel["type"="route_master"]["route_master"~"^(subway|light_rail)$"]["name"~"(Metro\\s*de\\s*Lima|L(í|i)nea\\s*\\d+|L\\s*\\d+)",i](-12.35,-77.20,-11.85,-76.75);
)->.r;
( .r; >; )->.m;
/* extras opcionales: estaciones de metro; puedes omitir todo este bloque si quieres */
(
  node["railway"="station"]["station"="subway"](-12.35,-77.20,-11.85,-76.75);
  node["railway"="station"]["subway"="yes"](-12.35,-77.20,-11.85,-76.75);
)->.s;
/* ⬇️ último out: relations + miembros + extras */
(.r; .m; .s;);
out body geom;


```
# Transporte

```json
[out:json][timeout:180];
{{geocodeArea:Lima}}   ->.l1;
{{geocodeArea:Callao}} ->.l2;
(.l1;.l2;)->.a;

(
  rel(area.a)["route"="bus"]
             ["network"!~"^(SIT|Metropolitano)$"]
             ["name"!~"^(Corredor\\s|X-(CR|EM|EO|IM|IO|OM|NM|NO))",i];
);

(._;>;);
out geom;

```




