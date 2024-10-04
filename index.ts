// import express, { Request, Response } from "express";
import { Server } from "ws";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import Alpaca from "@alpacahq/alpaca-trade-api";
import { AlpacaCryptoClient } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/crypto_websocket_v1beta3";
import { backOff } from "exponential-backoff";
import { Mutex } from "async-mutex";
import { AlpacaStocksClient } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/stock_websocket_v2";
import { GetQuotesParams } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/rest_v2";
import { EVENT, STATE } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/websocket";

dotenv.config();

const API_ENDPOINT = process.env.API_ENDPOINT as string;
const API_KEY = process.env.API_KEY as string;
const API_SECRET = process.env.API_SECRET as string;
const port = process.env.PORT as string;

type DataStreamOptions = {
    baseUrl: string;
    apiKey: string;
    secretKey: string;
    feed?: string;
};

type Config = {
    baseUrl: any;
    dataBaseUrl: any;
    dataStreamUrl: any;
    keyId: any;
    secretKey: any;
    apiVersion: any;
    oauth: any;
    feed: any;
    optionFeed: any;
    verbose: any;
};

class DataStream {
    alpaca: Alpaca;
    stocksSocket: AlpacaStocksClient;
    cryptoSocket: AlpacaCryptoClient;
    mutex: Mutex;
    isConnectedToCrypto = false;
    isConnectedToStocks = false;

    constructor({ baseUrl, apiKey, secretKey, feed }: DataStreamOptions) {
        this.mutex = new Mutex();

        this.alpaca = new Alpaca({
            baseUrl: baseUrl,
            keyId: apiKey,
            secretKey,
            // feed,
        });

        this.stocksSocket = this.alpaca.data_stream_v2;
        this.cryptoSocket = this.alpaca.crypto_stream_v1beta3;
    }

    async connect() {
        const release = await this.mutex.acquire();

        // if (this.isConnectedToCrypto || this.isConnectedToStocks) {
        //     return;
        // }

        if (this.isConnectedToCrypto) {
            return;
        }

        try {
            await Promise.all([
                this.connectToCrypto(),
                // this.connectToStocks()
            ]);
        } catch (error) {
            console.error(error);
        } finally {
            release();
        }
    }

    async disconnect() {
        this.cryptoSocket.disconnect();
    }

    async getCryptoAssets() {
        return this.alpaca.getAssets({ asset_class: "crypto", status: "active" });
    }

    async getQuotes(symbols: string[], options: GetQuotesParams, config?: Config) {
        return this.alpaca.getMultiQuotesV2(symbols, options, config);
    }

    async getCryptoQuotes(symbols: string[], options: GetQuotesParams, config?: Config) {
        return this.alpaca.getCryptoQuotes(symbols, options, config);
    }

    async getCryptoSnapshots(symbols: string[], config?: Config) {
        return this.alpaca.getCryptoSnapshots(symbols, config);
    }

    async getLatestCryptoQuotes(symbols: string[], config?: Config) {
        return this.alpaca.getLatestCryptoQuotes(symbols, config);
    }

    onDisconnectFromStocks = () => {
        console.log("disconnected from stocks");

        this.isConnectedToStocks = false;
    };

    onDisconnectFromCrypto = () => {
        console.log("disconnected from crypto");

        this.isConnectedToCrypto = false;
        // this.cryptoSocket.removeAllListeners();
    };

    private async connectToStocks() {
        return new Promise<void>((resolve, reject) => {
            this.stocksSocket.onConnect(() => {
                console.log("Connected to Stocks");
                this.isConnectedToStocks = true;
                this.stocksSocket.onDisconnect(this.onDisconnectFromStocks);
                resolve();
            });

            this.stocksSocket.onError((err) => {
                reject(err);
            });

            this.stocksSocket.connect();
        });
    }

    private async connectToCrypto() {
        return new Promise<void>((resolve, reject) => {
            this.cryptoSocket.once(STATE.AUTHENTICATED, () => {
                console.log("Connected to Crypto");
                this.isConnectedToCrypto = true;
                this.cryptoSocket.onDisconnect(this.onDisconnectFromCrypto);
                resolve();
            });

            this.cryptoSocket.once(EVENT.CLIENT_ERROR, (code) => {
                reject(code);
            });

            this.cryptoSocket.connect();
        });
    }
}

const runner = async () => {
    const passkey = uuidv4();

    console.log(`Using passkey ${passkey}`);

    const stream = new DataStream({
        baseUrl: API_ENDPOINT,
        apiKey: API_KEY,
        secretKey: API_SECRET,
    });

    // await backOff(() => stream.connect(), {
    //     delayFirstAttempt: true,
    //     startingDelay: 5000,
    //     numOfAttempts: 3,
    // });

    const wss = new Server({ host: "0.0.0.0", port: Number(port) });

    const sendToActiveClients = (data: any) => {
        wss.clients.forEach((client) => {
            if (client.readyState === client.OPEN) {
                client.send(data);
            }
        });
    };

    stream.cryptoSocket.onCryptoQuote((cryptoQuote) => {
        sendToActiveClients(JSON.stringify({ cryptoQuote }));
    });

    stream.cryptoSocket.onCryptoTrade((cryptoTrade) => {
        sendToActiveClients(JSON.stringify({ cryptoTrade }));
    });

    stream.cryptoSocket.onCryptoBar((cryptoBar) => {
        sendToActiveClients(JSON.stringify({ cryptoBar }));
    });

    wss.on("connection", (ws) => {
        console.log("new connection established");

        ws.on("error", console.error);

        ws.on("message", async (rawMessage) => {
            try {
                const message = JSON.parse(rawMessage.toString());

                if (true) {
                    switch (message.action) {
                        case "subscribeForCryptoQuotes": {
                            await stream.connect();
                            stream.cryptoSocket.subscribeForQuotes(message.symbols);
                            break;
                        }
                        case "subscribeForTrades": {
                            stream.cryptoSocket.subscribeForTrades(message.symbols);
                            break;
                        }
                        case "subscribeForBars": {
                            stream.cryptoSocket.subscribeForBars(message.symbols);
                            break;
                        }

                        case "getCryptoAssets": {
                            const cryptoAssets = await stream.getCryptoAssets();
                            // console.log(cryptoAssets);
                            ws.send(JSON.stringify({ cryptoAssets }));
                            // await stream.disconnect();
                            break;
                        }

                        case "getQuotes": {
                            const quotes = await stream.getQuotes(message.symbols, message.options ?? {});
                            ws.send(JSON.stringify({ quotes: Object.fromEntries(quotes) }));
                            break;
                        }

                        case "getCryptoQuotes": {
                            const cryptoQuotes = await stream.getCryptoQuotes(message.symbols, message.options ?? {});
                            ws.send(JSON.stringify({ cryptoQuotes: Object.fromEntries(cryptoQuotes) }));
                            break;
                        }

                        case "getCryptoSnapshots": {
                            const cryptoSnapshots = await stream.getCryptoSnapshots(message.symbols);
                            ws.send(JSON.stringify({ cryptoSnapshots: Object.fromEntries(cryptoSnapshots) }));
                            break;
                        }

                        case "getLatestCryptoQuotes": {
                            const latestCryptoQuotes = await stream.getLatestCryptoQuotes(message.symbols);
                            ws.send(JSON.stringify({ latestCryptoQuotes: Object.fromEntries(latestCryptoQuotes) }));
                            break;
                        }
                    }
                } else {
                    ws.close(4001, JSON.stringify({ message: "Unauthorized" }));
                }
            } catch (error) {
                console.error(error);

                ws.close();
            }
        });

        ws.on("close", () => {
            console.log("connection closed");
        });
    });

    // const app = express();

    // app.get("/", (request: Request, response: Response) => {
    //     response.status(200).send("Hello World");
    // });

    // app.listen(port, () => {
    //     console.log("Server running at PORT: ", port);
    // }).on("error", (error) => {
    //     // gracefully handle error
    //     throw new Error(error.message);
    // });
};

runner();
