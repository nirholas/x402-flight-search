/**
 * Per-route request/response contracts published inside the x402 402 challenge.
 *
 * GENERATED FROM `public/openapi.json` — do not hand-edit. Run `npm run schemas`
 * after changing the OpenAPI document so the runtime challenge and the published
 * metadata cannot drift apart.
 *
 * The x402scan discovery spec requires every `accepts[]` entry to carry
 * `outputSchema.input` and `outputSchema.output`. Together they are how an agent
 * calls a route it has never seen before: `input` describes the request in the
 * x402 Bazaar `type: "http"` shape, and `output` is the JSON Schema of the 200
 * body the agent receives once it has paid. All `$ref`s are inlined, since a
 * client reading the challenge has not fetched the OpenAPI document.
 *
 * Keys match the paywall route map exactly:
 *   GET /search
 *   GET /price/:offerId
 *   GET /check
 */

/** One paid route's published request/response contract. */
export interface RouteSchema {
  /** How to call the route: method, path/query parameters or JSON body fields. */
  input: Record<string, unknown>;
  /** JSON Schema of the 200 response body. */
  output: Record<string, unknown>;
}

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "GET /search": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {
        "origin": {
          "type": "string",
          "pattern": "^[A-Z0-9]{3}$",
          "description": "Required. 3-letter IATA origin"
        },
        "destination": {
          "type": "string",
          "pattern": "^[A-Z0-9]{3}$",
          "description": "Required. 3-letter IATA destination"
        },
        "date": {
          "type": "string",
          "format": "date",
          "description": "Required. Departure date, YYYY-MM-DD"
        },
        "adults": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9,
          "default": 1
        },
        "max": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "default": 5
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "source": {
          "enum": [
            "amadeus",
            "fixture"
          ],
          "description": "Whether this came from live Amadeus or deterministic fixtures"
        },
        "query": {
          "type": "object"
        },
        "currency": {
          "type": "string"
        },
        "offers": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "offerId": {
                "type": "string",
                "description": "Pass to GET /price/{offerId}"
              },
              "source": {
                "enum": [
                  "amadeus",
                  "fixture"
                ]
              },
              "price": {
                "type": "object",
                "properties": {
                  "total": {
                    "type": "string"
                  },
                  "currency": {
                    "type": "string"
                  }
                }
              },
              "validatingCarrier": {
                "type": "string"
              },
              "seatsRemaining": {
                "type": "integer"
              },
              "cabin": {
                "type": "string"
              },
              "segments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "from": {
                      "type": "string"
                    },
                    "to": {
                      "type": "string"
                    },
                    "departure": {
                      "type": "string"
                    },
                    "arrival": {
                      "type": "string"
                    },
                    "carrierCode": {
                      "type": "string"
                    },
                    "flightNumber": {
                      "type": "string"
                    },
                    "durationMinutes": {
                      "type": "integer"
                    }
                  }
                }
              }
            },
            "required": [
              "offerId",
              "price",
              "segments"
            ]
          }
        },
        "retrievedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "source",
        "offers",
        "retrievedAt"
      ]
    }
  },
  "GET /price/:offerId": {
    "input": {
      "type": "http",
      "method": "GET",
      "pathParams": {
        "offerId": {
          "type": "string"
        }
      },
      "queryParams": {}
    },
    "output": {
      "type": "object",
      "properties": {
        "source": {
          "enum": [
            "amadeus",
            "fixture"
          ]
        },
        "offerId": {
          "type": "string"
        },
        "confirmed": {
          "type": "boolean"
        },
        "offer": {
          "type": "object",
          "properties": {
            "offerId": {
              "type": "string",
              "description": "Pass to GET /price/{offerId}"
            },
            "source": {
              "enum": [
                "amadeus",
                "fixture"
              ]
            },
            "price": {
              "type": "object",
              "properties": {
                "total": {
                  "type": "string"
                },
                "currency": {
                  "type": "string"
                }
              }
            },
            "validatingCarrier": {
              "type": "string"
            },
            "seatsRemaining": {
              "type": "integer"
            },
            "cabin": {
              "type": "string"
            },
            "segments": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "string"
                  },
                  "to": {
                    "type": "string"
                  },
                  "departure": {
                    "type": "string"
                  },
                  "arrival": {
                    "type": "string"
                  },
                  "carrierCode": {
                    "type": "string"
                  },
                  "flightNumber": {
                    "type": "string"
                  },
                  "durationMinutes": {
                    "type": "integer"
                  }
                }
              }
            }
          },
          "required": [
            "offerId",
            "price",
            "segments"
          ]
        },
        "priceGuarantee": {
          "type": "string"
        },
        "pricedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "offerId",
        "confirmed",
        "offer"
      ]
    }
  },
  "GET /check": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {
        "origin": {
          "type": "string",
          "description": "Required."
        },
        "destination": {
          "type": "string",
          "description": "Required."
        },
        "date": {
          "type": "string",
          "format": "date",
          "description": "Required."
        },
        "adults": {
          "type": "integer",
          "default": 1
        },
        "previousPrice": {
          "type": "number",
          "description": "Your last observed price; omit on the first poll"
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "source": {
          "enum": [
            "amadeus",
            "fixture"
          ]
        },
        "query": {
          "type": "object"
        },
        "snapshot": {
          "type": "object",
          "properties": {
            "lowestTotal": {
              "type": "string"
            },
            "currency": {
              "type": "string"
            },
            "offerId": {
              "type": "string"
            },
            "carrier": {
              "type": "string"
            },
            "retrievedAt": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        "delta": {
          "type": "object",
          "properties": {
            "previousPrice": {
              "type": [
                "number",
                "null"
              ]
            },
            "currentPrice": {
              "type": "number"
            },
            "change": {
              "type": [
                "number",
                "null"
              ]
            },
            "changePct": {
              "type": [
                "number",
                "null"
              ]
            },
            "verdict": {
              "enum": [
                "dropped",
                "rose",
                "unchanged",
                "no-cursor"
              ]
            }
          }
        }
      },
      "required": [
        "snapshot",
        "delta"
      ]
    }
  }
};
