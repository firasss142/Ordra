---
title: "Navex API | API Reference"
source: "https://app.navex.tn/api/kassandrashop-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256/documentation/"
author:
published:
created: 2026-04-16
description:
tags:
  - "clippings"
---
## Navex Widget Form API API Reference

**Exemple d'envoi curl:**

```
$ch = curl_init();
$post_data = "prix=" . addslashes($_POST['prix']) . "&nom=" . addslashes($_POST['nom']) . "&gouvernerat=" . addslashes($_POST['gouvernerat']) . "&ville=" . addslashes($_POST['ville']) . "&adresse=" . addslashes($_POST['adresse']) . "&tel=" . addslashes($_POST['tel']) . "&tel2=" . addslashes($_POST['tel2']) . "&designation=" . addslashes($_POST['designation']) . "&nb_article=" . addslashes($_POST['nb_article']) . "&msg=" . addslashes($_POST['msg']) ."&echange=" . addslashes($_POST['echange']) ."&article=" . addslashes($_POST['article']) ."&nb_echange=" . addslashes($_POST['nb_echange']) ."&ouvrir=" . addslashes($_POST['ouvrir']) ."&sender_name=" . addslashes($_POST['sender_name']) ."&sender_location=" . addslashes($_POST['sender_location']) . "";
//print_r($post_data);
curl_setopt($ch, CURLOPT_URL, "https://app.navex.tn/api/kassandrashop-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256/v1/post.php");
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, $post_data);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, TRUE);
curl_setopt($ch, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, 1);

$server_output = curl_exec($ch);
curl_close($ch);
print_r($server_output);
```

##### API Endpoint

```
https://app.navex.tn/
```

##### Contact: contact@navex.tn

##### Schemes: https

##### Version: 1.0.0

## Authentication

### basicAuth

Votre token d'authentification est: kassandrashop-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256  
Il est strictement confidentiel et ne doit jamais Ãªtre transmis Ã  un tiers.  
**Attention**: L'exemple curl fourni en tÃªte de document contient votre token d'authentification. Ne pas partager cet exemple Ã  un tiers.

type

basic

## Paths

[form](#tag-form)

## Envoi d'un colis

POST /api/kassandrashop-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256/v1/post.php

L'envoi d'un colis doit Ãªtre effectuÃ© en POST  
Le corps du message doit suivre le format dÃ©crit (voir exemple ci-contre)  
Toutes les donnÃ©es doivent Ãªtre prÃ©sentes dans le corps du message. En cas de valeur non obligatoire, veuillez renseigner une chaine vide.

undefined

##### Request Content-Types: application/json

##### Request Example

```json
"prix=" . addslashes($_POST['prix']) . "&nom=" . addslashes($_POST['nom']) . "&gouvernerat=" . addslashes($_POST['gouvernerat']) . "&ville=" . addslashes($_POST['ville']) . "&adresse=" . addslashes($_POST['adresse']) . "&tel=" . addslashes($_POST['tel']) . "&tel2=" . addslashes($_POST['tel2']) . "&designation=" . addslashes($_POST['designation']) . "&nb_article=" . addslashes($_POST['nb_article']) . "&msg=" . addslashes($_POST['msg']) ."&echange=" . addslashes($_POST['echange']) ."&article=" . addslashes($_POST['article']) ."&nb_echange=" . addslashes($_POST['nb_echange']) ."&ouvrir=" . addslashes($_POST['ouvrir']) ."&sender_name=" . addslashes($_POST['sender_name']) ."&sender_location=" . addslashes($_POST['sender_location']) . ""
```

201 Created

Colis ajoutÃ© avec succÃ¨s

400 Bad Request

Erreur lors de la crÃ©ation du colis. Une valeur est manquante ou ne respecte pas les conditions de format

401 Unauthorized

DonnÃ©es d'authentification manquante

403 Forbidden

Erreur d'authentification

404 Not Found

Widget non trouvÃ©. Vous essayez d'accÃ©der Ã  une campagne inconnue

500 Internal Server Error

Erreur interne du serveur

##### Response Content-Types: application/json

##### Response Example (201 Created)

```json
{
  "status": "string",
  "status_message": "Product Added."

}
```

##### Response Example (400 Bad Request)

```json
{
  "status": "string",
    "status_message": "ERREUR!."
}
```

##### Response Example (404 Not Found)

```json
{
  "status": "string",
  "message": "widget not found"
}
```

## Schema Definitions

## response201: object

status: string

colis:

## response404: object

##### Example

```json
{
  "status": "string",
  "message": "widget not found"
}
```

## response400: object

##### Example

```json
{
  "status": "string",
  "status_message": "ERREUR!."
}
```

## ColisInformations: object

prix: string

nom: string

gouvernerat: string Ariana, BÃ©ja, Ben Arous, Bizerte, GabÃ¨s, Gafsa, Jendouba, Kairouan, Kasserine, KÃ©bili, La Manouba, Le Kef, Mahdia, MÃ©denine, Monastir, Nabeul, Sfax, Sidi Bouzid, Siliana, Sousse, Tataouine, Tozeur, Tunis, Zaghouan

ville: string

adresse: string

tel: string

tel2: string

designation: string

nb\_article: number

msg: string

echange: string

article: string

nb\_echange: string

ouvrir: string Oui, Non,

Uniquement pour les marketplaces

sender\_name: string

sender\_location: string