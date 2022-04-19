# 7Energy DAO

## Beschreibung

Dies ist eine Implementierung eines Abrechnungssystems für Energie-Gemeinschaften (EGs) für EVM-basierte Blockchains.  
Kern des Systems ist der smart contract namens _SEDAO_. Bei der Initialisierung des contracts werden ein Abrechnungs-Token und ein Betrag definert.
Der Abrechnungs-Token ist die Einheit, in der Verrechnungen zwischen den EG-Mitgliedern stattfinden. Idealerweise ist dies ein _stable token_, dessen Wert an die lokal genutzte Währung gekoppelt ist.  
Es wird davon ausgegangen, dass dieser Abrechnungs-Token auf der benutzten Blockchain bereits existiert.  
Um sich im smart contract als Mitglied der EG zu registrieren, muss die Methode `join` aufgerufen werden. Diese verursacht eine Abbuchung des initial definierten Betrags vom Konto des Aufrufers. Sollte dies fehlschlagen - etwa aufgrund fehlender Berechtigung - schlägt auch die Transaktion für die Beitritt fehl.  
Die so eingezogenen Beitritts-Beträge (`admissionAmount` im Quellcode) verbleiben im SEDAO-contract.  
Im Zuge eines Beitritts werden dem neuen Mitglied _shares_ proportional zum eingezahlten Beitrag zugewiesen. Diese shares sind wie der Abrechungs-Token ein [ERC-20 - Token](https://eips.ethereum.org/EIPS/eip-20).
Im Gegensatz dazu wird der share-Token-contract jedoch bei der Initialisierung neu erstellt und ist fix an den SEDAO-contract gebunden - dieser ist der _owner_ (Besitzer) des share-Token-contracts.
share-token sind nicht frei übertragbar, sondern unterliegen dem von der SEDAO implementierten Regelwerk.
In dieser 1. Version haben shares folgende 2 Funktionen:
* Mitglieder können die EG verlassen, indem sie die Methode `leave` aufrufen. Dabei werden die verbliebenen shares eingezogen und vernichtet, und ein den eingezogenen Betrag entsprechender Betrag an Abrechnungs-Token wird ausbezahlt.
* Falls von einem Mitglied im Zuge einer Abrechnungsperiode nicht genügend Abrechungs-Token eingezogen werden können, werden stattdessen share-Token im selben Wert eingezogen und vernichtet, und Abrechnungs-Token aus dem SEDAO-contract selbst für die Bezahlung benutzt.
Die shares sind also werthaltig - der Wert ist fix an den Wert der Abrechnungs-Token gekoppelt - und repräsentieren einen Anspruch auf vom SEDAO-contract gehaltene Abrechnugs-Token.
Der contract beinhaltet auch Methoden, über die Mitglieder weitere shares gegen Abrechnungs-Token kaufen oder überschüssige shares gegen Abrechnungs-Token verkaufen können. Diese Funktionalität ist eine Vorbereitung darauf, den share-Token mit einem komplexeren ökonomischen Design zu gestalten, welches die Attraktivität einer Mitgliedschaft erhöhen soll.  
Mit Blick auf eine solche künftige Entwicklung gibt es im contract auch eine Methode `preferShares`, über die ein Mitglied einstellen kann, dass es an die EG gelieferte Energie bevorzugt in share-Token (anstatt in Abrechungs-Token) ausbezahlt kriegen möchte. Die überschüssigen Abrechungs-Token der Abrechnungsperiode verbleiben in diesem Fall im SEDAO-contract und könnten potenziell in einer für die EG vorteilhafte Weise genutzt werden.

Einige Funktionen des SEDAO-contracts sind einem Administrator-Account vorbehalten. Diese sind mit dem Solidity-modifier `onlyAdmin` markiert.  
Der Administrator kann:
* die contract-Logik aktualisieren, etwa um Funktionalitäten hinzuzufügen
* _Orakel_ (`oracles` im Quellcode) definieren - das sind Accounts mit der Berechtigung, Abrechnungsdaten einzuspielen

Die wichtigsten Transaktionen im Betrieb dieses Systems sind die Aufrufe der Methode `prosumed`, welche nur von Orakel-Accounts aufgerufen werden können.  
Bei diesen Aufrufen wird für die EG-Mitglieder eine Liste von Netto-Verbrauchs- bzw. Produktionsdaten in der Einheit Watt-Stunden (im Quellcode `whDeltas`) übergeben. Dabei stehen positive Werte für Netto-Produktion und negative Werte für Netto-Verbrauch über die Abrechnungsperiode. 
Anhand des ebenfalls übergebenen Energie-Preises für die Abrechnungsperiode (`whPrice`) wird nun vom contract für jedes EG-Mitglied der einzuziehende bzw. auszuzahlende Betrag an Abrechnungs-Token berechnet und diese Abrechungs auch sofort getätigt, falls nötig mit Rückgriff auf die shares eines Mitglieds - wie oben beschrieben.  


Der SEDAO-contract ermöglicht günstige (wenn auf einer EVM-Blockchain mit niedrigen Transaktionsgebühren betrieben) und automatisierte Abrechnung mit fast beliebig hoher Frequenz.  
Da die für eine korrekte Ausführung nötigen Verbrauchsdaten von außen eingespeist werden, ist dieser contract nur so zuverlässig wie die Personen und Infrastruktur, welche über Administrator-Account und die Orakel-Accounts verfügen. Dies ist bei der Handhabung dieser Accounts zu berücksichtigen.  
Diese Abhängigkeit von externen Komponenten ist auch der Grund dafür, warum der contract in dieser Version keine weitere Logik für die Akzeptanz/Freischaltung von Mitgliedern benötigt.  
_Überschüssige_ Mitglieder (Personen, die sich im SEDAO-contract als Mitglieder registriert haben, ohne wirklich EG-Mitglied zu sein) können einfach ignoriert werden. Sie sind in den von Orakeln eingespielten Abrechnungsdaten einfach nicht enthalten und können nichts weiter machen als Abrechnungs-Token in share-Token zu konvertieren und umgekehrt.  
In einer künftigen Version könnte für die Aufnahme von Mitgliedern auch im contract ein Freischaltungs-Schritt hinzugefügt werden.

## Entwicklung

node.js v14+ und eine dazu passende Version von npm müssen bereits installiert sein.

Um das Projekt für lokale Entwicklung einzurichten, sind folgende Schritte nötig:

Eine Kopie beziehen
```
git clone http://github.com/d10r/7energy-contracts
```

Ins Projekt-Verzeichnis wechseln
```
cd 7energy-contracts
```

Abhängigkeiten installieren
```
npm ci
```

Dies installiert unter anderem das EVM-Entwicklungs-System [hardhat](https://hardhat.org), das als Basis für weitere Ausführungen fungiert.  
Um die Tests auszuführen:
```
npx hardhat test
```

## Simulation

`scripts/simulate.js` ist ein Skript für eine Simulation eines 1 Jahr dauernden Betriebs einer EG mit 14 Mitgliedern.  
Die Verbrauchsdaten dafür befinden sich in `data/sim.csv`. Es sind reale Daten aus Haushalten in einer Modellregion im Burgenland, welche einer anonymisierten Verwendung dieser Daten zugestimmt haben.
Die Frequenz der Abrechung beträgt 1 Tag.

Nach Einrichtung der Entwicklungsumgebung (siehe vorheriger Absatz) kann die Simulation folgendermaßen gestartet werden:
```
npx hardhat run scripts/simulate.js
```

Mit diesem Aufruf erfolgt die Simulation auf einer lokal gestarteten Test-Blockchain im Zeitraffer (2 Sekunden pro Abrechnungsperiode).  
Über folgende Umgebungsvariablen kann das Verhalten geändert werden:
* `FILENAME`: Pfad zur Datei mit den Simulationsdaten
* `SLOT_DURATION`: Zeit in Sekunden, mit denen die Dauer einer Abrechnungsperiod simuliert werden soll
* `INITIAL_PAYMENT_TOKENS`: Betrag an Abrechnungs-Token, den jedes Mitglied bei der Initialisierung erhält
* `APPROVAL_AMOUNT`: Betrag in Abrechnungs-Token, den der SEDAO-contract insgesamt von Mitgliedern abbuchen darf - Überweisungen vom SEDAO-contract zu einem Mitglied erhöhen diesen Betrag nicht
* `KWH_PRICE`: Preis in Abrechnungs-Token für 1 Kilowattstunde
* `MNEMONIC`: (nur für Ausführung auf einem öffentlichen Netzwerk relevant) Mmemonic, von dem die in der Simulation verwendeten Accounts abgeleitet werden

Um die Simulation auf einem öffentlichen Blockchain-Netzwerk auszuführen, kann die hardhat-Option `--network` benutzt werden.  
In der hardhat-Konfigurations-Datei `hardhat.config.js` gibt es bereits einen Eintrag für das Ethereum-Testnet _kovan_. Um dieses zu benutzen, lautet der Aufruf etwa:
```
npx hardhat run scripts/simulate.js --network kovan
```

Für erfolgreiche Ausführung muss in diesem Fall der Standard-Account für dieses Netzwerk native Token für Transaktionsgebühren haben.

Eine beispielhafte Ausführung der Simulation auf dem Kovan-Netzwerk wurde mit dieser Instanz eines SEDAO-contracts gemacht: [0xa0049a57AF74B2234e1A10e5e577040BAcF46f03](https://kovan.etherscan.io/address/0xa0049a57AF74B2234e1A10e5e577040BAcF46f03)  
Die simulierte Dauer einer Abrechnungsperiode betrug dabei 10 Sekunden.

Nach erfolgreicher Ausführung einer Simulation wird eine Datei `sim_report.json` angelegt, in der sich die Änderung der Kontostände (Abrechungs-Token und share-Token) der EG-Mitglieder nach jeder Abrechnungsperiode nachvollziehen lässt.