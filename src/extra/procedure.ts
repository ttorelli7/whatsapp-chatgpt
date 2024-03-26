import jaccardSimilarity from "../util/jaccardSimilarity";
import removeAccents from "../util/removeAccents";
const natural = require('natural');

class Procedure {
    PROCEDURE_SEPARATOR = '. ';

    getProceduresNames() {
        return Object.keys(this.getProcedures());
    }

    getProcedures(addNumeric = false) {
        let procedures = {
            'MAF': 60,
            'Massagem visceral': 30,
            'Relaxamento / dor muscular': 30,
            'Revitalização / hidratação facial': 30,
            'Consulta': 60 * 2,
            'Consultoria online': 60 * 3,
            'Limpeza de pele': 60 * 2,
            'Pós operatório imediato (até 20 dias)': 60 * 3,
            'Pós operatório tardio (após 20 dias)': 60 + 30,
            'Peeling químico': 60,
            'Personalizado corporal / facial (horário duplo)': 60 * 2,
            'Personalizado corporal / facial (horário triplo)': 60 * 3,
            'Injetáveis estéticos corporais': 60,
            'Injetáveis estéticos faciais': 60,
            'Personalizado (corporal / facial)': 60,
            'Skinbooster': 60 * 2,
            'Terapia capilar': 60,
            'Detox funcional': (60 * 2) + 30,
            'Saúde integrativa aplicação': 30
        };
        if (!addNumeric) {
            return procedures;
        }
        let keys = Object.keys(procedures);
        let newKeys = {};
        keys.forEach((key, index) => {
            newKeys[String(index + 1) + this.PROCEDURE_SEPARATOR + key] = procedures[key];
        });
        return newKeys;
    }

    getProcedure(procedure) {
        let procedures = this.getProcedures(true);
        let names = Object.keys(procedures);
        let found = -1;
        let highestSimilarity = 0;
        let minSimilarityScore = 0.2;
        for (let i = 0; i < names.length; i++) {
            let sep = names[i].split(this.PROCEDURE_SEPARATOR);
            if (!isNaN(procedure) && procedure == sep[0]) {
                found = i;
                break;
            }
            const similarity = jaccardSimilarity(
                new Set(natural.PorterStemmer.tokenizeAndStem(removeAccents(sep[1].toLowerCase()))),
                new Set(natural.PorterStemmer.tokenizeAndStem(removeAccents(procedure.toLowerCase())))
            );
            if (similarity > highestSimilarity && similarity >= minSimilarityScore) {
                highestSimilarity = similarity;
                found = i;
            }
        };
        if (found == -1) {
            throw new Error(`Procedimento '${procedure}' inexistente, por favor informe outro nome!`);
        }
        let sep = names[found].split(this.PROCEDURE_SEPARATOR);
        return {
            key: sep[1],
            value: procedures[names[found]]
        };
    }


    getMessageCheckSlotsString() {
        return 'Solicitação de consulta de disponibilidade de horário';
    }

    getMessageScheduleString() {
        return 'Solicitação de agendamento de horário';
    }

    getMessageCheckScheduleString() {
        return 'Solicitação de consulta de horários agendados';
    }

    getMessageDeleteScheduleString() {
        return 'Solicitação de cancelamento de horário';
    }

    getMessageString() {
        return `de horário de`;
    }

    isMessage(message) {
        return
    }
}

export const procedure = new Procedure();