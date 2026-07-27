# Où j'en suis exactement — point d'arrêt du 27/07/2026, ~22h

> Budget de session épuisé. Ce fichier dit **précisément** où reprendre.
> Le contexte long (art direction, décisions, pièges) est dans `PLAN.md`.
> Ce fichier-ci est la checklist opérationnelle.

## Reprendre en 30 secondes

```sh
cd ~/Projects/vibecode/sakurajima
python3 serve.py 5173
# puis ouvrir http://127.0.0.1:5173/index.html et regarder la console
```

**La scène ne s'affiche pas encore.** Elle construit les 9 étapes jusqu'au bout,
entre dans la boucle de rendu, et plante à la première frame. Voir « prochaine
erreur » ci-dessous.

---

## État réel, vérifié en navigateur

Le pipeline de chargement va **jusqu'au bout des 9 étapes** (vent → relief →
étangs → cerisiers → herbe → pétales → ciel → nuages → oiseaux), puis démarre
`renderer.setAnimationLoop`. Donc : tous les modules se chargent, toutes les
géométries se construisent, aucun shader ne refuse de compiler à la
construction. Ce qui reste est du câblage d'interfaces entre modules.

### Corrections déjà appliquées (ne pas les refaire)

| # | Fichier | Problème | Correctif |
|---|---|---|---|
| 1 | `src/petals.js` | Backticks dans un commentaire **à l'intérieur** d'un template literal GLSL → `SyntaxError` | Backticks retirés |
| 2 | `src/petals.js` | Variable nommée `mv` alors que le chunk `<fog_vertex>` de three exige littéralement `mvPosition` | Renommée |
| 3 | `index.html` | Script module **inline** : une erreur de parse pointait sur le HTML, indébuggable | Sorti dans `src/boot.js` |
| 4 | `serve.py` | `text/html` sans charset → le navigateur retombait sur un encodage legacy | `charset=utf-8` ajouté sur html/js/css/json |
| 5 | `src/island.js:77` | **Sortie d'agent corrompue** : `shallow: 0x123murk = 0x123a48` (charabia) | → `shallow: 0x123a48` |
| 6 | `src/sakura.js:813` | `g.index` supposé non-nul ; une `BufferGeometry` non indexée a `index === null` → `Cannot read properties of null (reading 'count')` | Indices séquentiels synthétisés si `index` absent |
| 7 | `src/main.js` | `grass.update(t, phase)` — le 2ᵉ argument est la **caméra**, pas la phase | → `grass.update(t, camera)` + `setSun()` séparé |
| 8 | `src/wind.js` | `grass.js` appelle `windForce(pos)` à 1 argument, le mien en prenait 2 | Surcharge GLSL ajoutée |

### ⚠️ Prochaine erreur à traiter — c'est ici qu'il faut reprendre

Le correctif **#7 vient d'être écrit mais n'a pas encore été rechargé en
navigateur.** Première chose à faire : recharger et relire la console.

Erreur observée juste avant le correctif :
```
TypeError: activeCamera.getWorldPosition is not a function
    at Object.update (src/grass.js:879:16)
    at frame (src/main.js:183:15)
```

Après ce correctif, s'attendre à la **même classe de problème sur les autres
modules** : chaque `update()` a été conçu par un agent différent, donc les
signatures divergent. Vérifier une par une, dans `main.js` → `frame()` :

- `island.update(t, phase)` — vérifier la signature attendue
- `ponds.update(t, dt, phase)` — actuellement un stub, no-op
- `forest.update(t, phase)` — **suspect**, `sakura.js` a son propre système de vent
- `petals.update(t, phase)` — écrit par moi, signature sûre
- `clouds.update(t, dt, phase)` — stub
- `birds.update(t, dt, phase)` — stub
- `sky.update(dayTime, dt)` doit renvoyer l'objet `phase` que tous les autres
  consomment. **Vérifier ce qu'il renvoie réellement** : `main.js` suppose
  `{ sunDirection, sunColor, ambientColor, goldenHour, sunIntensity }`.

---

## Interrompu volontairement

**Le 2ᵉ workflow d'agents (étangs+koi / oiseaux / nuages) a été tué** pour
économiser le budget, en phase Design, avant d'avoir produit ses résultats.
Rien à récupérer de ce run : **il faudra le relancer**. Le script est sauvegardé
et réutilisable tel quel :

```
~/.claude/projects/-Users-fourreto-Projects-vibecode-sakurajima/…/workflows/scripts/sakura-island-life-wf_4e530dc3-58a.js
```

**Le 1er workflow a également été tué**, mais **après** que ses 5 designs soient
terminés et extraits — donc rien de perdu côté design. En revanche sa phase
`Verify` (5 agents adverses qui produisent `corrected_code`) n'a pas fini.
Les corrections API/GLSL qu'elle aurait produites sont perdues ; les bugs #5,
#6 et #7 ci-dessus sont typiquement ce qu'elle aurait attrapé automatiquement.

Les designs bruts extraits sont conservés dans `/tmp/sakura-designs/`
(⚠️ `/tmp` est effacé au redémarrage — **les copier ailleurs si besoin**,
mais les 4 modules utiles sont déjà installés dans `src/`).

---

## Reste à faire, dans l'ordre

1. **Faire afficher la scène.** Recharger, corriger les signatures d'`update()`
   une par une jusqu'à la première image. C'est du câblage, pas de la conception.
2. **Vérifier que les props collent au sol** — arbres et herbe doivent utiliser
   `island.heightAt()`. S'ils flottent, c'est que le maillage du terrain et
   `heightAt` n'échantillonnent pas le même bruit.
3. **Rebrancher `sakura.js` sur le vent partagé** (il a réimplémenté le sien :
   `WIND_GLSL`, `createWindUniforms`). Faire comme `grass.js`, qui accepte
   proprement `wind: { WIND_GLSL, uniforms }`.
4. **Relancer le workflow étangs/oiseaux/nuages**, puis remplacer les trois
   stubs `src/ponds.js`, `src/birds.js`, `src/clouds.js`.
5. **Shiba Inu jouable** — spécifié en détail dans `PLAN.md` §5.
6. **Peaufinage** — densité/taille des pétales à rejuger dans la scène réelle
   (le banc d'essai `test/petals.html` n'est pas représentatif), cadrage de la
   caméra d'ouverture, ombres de nuages, rayons crépusculaires.

---

## Ce qui est solide et ne demande pas de retouche

- `src/noise.js` — validé numériquement sous node (déterminisme, plages,
  `ridged2` positif). Source de vérité unique pour la hauteur.
- `src/wind.js` — modèle en train de rafales conforme à la demande
  (accalmies réelles, cap aléatoire). JS et GLSL jumeaux.
- `src/petals.js` — **validé visuellement en navigateur**, shader compile,
  culbute et translucidité correctes. Seul le réglage densité/taille reste ouvert.
- `src/config.js`, `index.html`, `serve.py` — stables.
