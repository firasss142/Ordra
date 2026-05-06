package trackers

import (
	"DeliveryService/config"
	"DeliveryService/structures"
	"context"
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

var NavexStoreTokenMap = make(map[primitive.ObjectID]string)

// constant map from navex status to our status
var NavexStatusMap = map[string]string{
	"En attente": "",

	"En cours": "in transit",

	"Au magasin": "deposit",

	"Rtn depot": "deposit",

	"Livrer": "delivered",

	"Rtn client/agence": "returned",

	"Rtn definitif": "to be returned",

	"Retour recu": "returned",

	"Retour paye": "returned",

	"Retour Expediteur": "returned",

	"A verifier": "unverified",

	"Echange": "",

	"A enlever": "",

	"Enleve": "deposit",

	"Non recu": "",

	"Supprime": "cancelled",
}

// should return the normalized order status (delivered, etc ...)
func NavexSingle(storeID primitive.ObjectID, barcode string) (string, error) {
	storeToken, ok := NavexStoreTokenMap[storeID]
	if !ok {
		// get the store
		collection := config.Mongo.Collection("stores")
		filter := bson.M{
			"_id": storeID,
		}
		var store structures.Store
		err := collection.FindOne(context.Background(), filter).Decode(&store)
		if err != nil {
			return "", err
		}
		// get the navex token
		for _, integration := range store.Integrations {
			if integration.Ref == "navex" {
				if integration.Fields["key"] != "" {
					storeToken = integration.Fields["key"].(string)
					NavexStoreTokenMap[storeID] = storeToken
				}
			}
		}
	}

	// check if the token is empty
	if storeToken == "" {
		return "", errors.New("navex token is empty")
	}

	// fetch the order status
	status, err := fetchFromNavex(barcode, storeToken)
	if err != nil {
		return "", err
	}

	if status == "" {
		return "", nil
	}

	// map the status
	mappedStatus, ok := NavexStatusMap[status]
	if ok {
		return mappedStatus, nil
	}

	return "", errors.New("unknown status" + status)
}

func fetchFromNavex(barcode string, key string) (string, error) {

	// get the <token> part
	token := key[strings.LastIndex(key, "-")+1:]
	fullKey := key[:strings.LastIndex(key, "-")] + "-etat-" + token

	// prepare the request
	payload := strings.NewReader("code=" + barcode)

	req, err := http.NewRequest("POST", "https://app.navex.tn/api/"+fullKey+"/v1/post.php", payload)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	// send the request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// example response: {"status":1,"etat":"A enelver","status_message":"674335988001"}
	// Content-Type: text/html; charset=UTF-8
	// we want "etat"

	var response map[string]interface{}
	var responseArray []map[string]interface{}
	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Attempt to decode into a map
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		// Hotfix for the API: sometimes it returns an array depending on the API version
		err = json.Unmarshal(bodyBytes, &responseArray)
		if err != nil {
			return "", err
		}
		if len(responseArray) == 0 {
			return "", errors.New("empty response")
		}
		response = responseArray[0]
	}

	status, ok := response["etat"].(string)
	if !ok {
		return "", errors.New("no status")
	}

	if status == "" {
		// We have done this because the API always returns status 200
		statusMessage, ok := response["status_message"].(string)
		if ok && statusMessage == "ERREUR!." {
			log.Default().Println("NavexSingle: status_message is ERREUR!. in order", barcode)
			return "", nil
		}
	}

	return status, nil
}