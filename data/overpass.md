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
[out:json][timeout:120];
{{geocodeArea:Lima}}->.a;

/* Alimentadoras del Metropolitano: por nombre o por prefijo de ref (AN-/AS-) */
(
  rel["route"="bus"]["network"="Metropolitano"]["name"~"^Alimentadora",i](area.a);
  rel["route"="bus"]["network"="Metropolitano"]["ref"~"^(AN|AS)-"](area.a);
)->.r;

/* Solo los ways de esas relaciones, con geometría */
way(r.r);
out tags geom;
```
# Metro

```json
[out:json][timeout:120];
{{geocodeArea:Lima}}->.a;

/* Rutas de metro (subway/light_rail) por network o por nombre */
(
  rel["type"="route"]["route"~"^(subway|light_rail)$"]["network"~"Metro",i](area.a);
  rel["type"="route"]["route"~"^(subway|light_rail)$"]["name"~"(Metro\\s+de\\s+Lima|L(í|i)nea\\s*[12])",i](area.a);
)->.r;

/* Solo los ways de esas relaciones, con geometría */
way(r.r);
out tags geom;
```





