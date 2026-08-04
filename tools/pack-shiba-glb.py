#!/usr/bin/env python3
"""pack-shiba-glb.py — glTF + .bin + PNG -> .glb autonome.

One-shot HORS RUNTIME. Le depot ne versionne que le .glb produit ; ce script
existe pour que ce binaire reste REPRODUCTIBLE a partir des trois sha256
consignes dans docs/superpowers/specs/2026-08-04-shiba-gltf-design.md.

Pourquoi un .glb et pas les trois fichiers : le projet n'a AUCUNE convention de
resolution d'URI d'asset (ni import.meta.url, ni relatif-page), et serve.py n'a
pas de type MIME pour .bin ni .png. Un fichier autonome supprime les deux
problemes — un seul fetch, path = '', aucune resolution.

Ce script ne touche NI aux materiaux NI aux noeuds : KHR_materials_unlit et
doubleSided doivent survivre intacts, le rig s'appuie dessus (src/shiba-gltf.js
reconstruit un MeshStandardMaterial precisement parce que le loader rend un
MeshBasicMaterial pour un materiau unlit).

Usage :
    python3 tools/pack-shiba-glb.py scene.gltf scene.bin base1024.png shiba.glb
"""
import json
import struct
import sys


def pad(b, n, fill):
    """Complete b jusqu'a un multiple de n octets. Le GLB l'exige pour les deux
    chunks, avec un remplissage DIFFERENT pour chacun : espaces pour le JSON
    (sinon le parseur voit des octets nuls dans le texte), zeros pour le binaire."""
    return b + fill * ((-len(b)) % n)


def main(src_gltf, src_bin, src_png, out):
    g = json.load(open(src_gltf))
    bin_data = open(src_bin, 'rb').read()
    png = open(src_png, 'rb').read()

    # 1. Un seul buffer : scene.bin aligne, puis le PNG. L'alignement sur 4 est
    #    obligatoire — les accessors du .bin lisent des flottants, et un
    #    bufferView desaligne est un comportement indefini.
    bin_aligned = pad(bin_data, 4, b'\0')
    img_offset = len(bin_aligned)
    buffer = bin_aligned + png

    # 2. L'image passe en reference interne.
    g['bufferViews'].append({
        'buffer': 0,
        'byteOffset': img_offset,
        'byteLength': len(png),
    })
    g['images'][0] = {
        'bufferView': len(g['bufferViews']) - 1,
        'mimeType': 'image/png',
    }

    # 3. Le buffer perd son uri : c'est ce qui fait de lui le chunk BIN du GLB.
    g['buffers'][0] = {'byteLength': len(buffer)}

    # 4. Serialisation.
    js = pad(json.dumps(g, separators=(',', ':')).encode('utf-8'), 4, b' ')
    bn = pad(buffer, 4, b'\0')
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))   # magic 'glTF', v2
        f.write(struct.pack('<II', len(js), 0x4E4F534A))     # chunk 'JSON'
        f.write(js)
        f.write(struct.pack('<II', len(bn), 0x004E4942))     # chunk 'BIN\0'
        f.write(bn)
    print('%s : %d octets' % (out, total))


if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:5])
