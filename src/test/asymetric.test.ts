import * as CR from 'node:crypto';
import { describe } from 'node:test';

const key = CR.createPrivateKey(`
-----BEGIN PRIVATE KEY-----
MIICdQIBADANBgkqhkiG9w0BAQEFAASCAl8wggJbAgEAAoGBAJtAJhM9rF7uP+jo
w8OUqqSUS9YuFK9kYxgcs/Avn2YSpobW9zInoHqUVVRe78LSYDuQAnzH6L9S5PJe
9rP9ORrQP2X89wqElR3egBlGWW/ACm3GpNyfSb4uvngxuINLL8nQ182Dt5NxQjB6
+r9NlLQHIWxQXHNfPBhLzmTUdYoHAgMBAAECgYB0efdW/jFhc5xNULz28oXoPj57
bU0lncpe38H8VK5hdWKszYDehy52aO1wBF4bq5x5c3z6Qz2StU2Brc+nkDcThLyI
gop3Tl2wH/AvUm9QLLxm+UtkdXCHRarIvLeG8+YZlfHFEqH4S3grfkm0xdn0rdaR
L0GgOcKanfEiJUEloQJBAMkW94RuTjWpwRljL0b2ldepjSr894jdg1TtHYYGJg5Q
MqvQdWx8EsPGoIUsmr7ZBHHXFgFZWOJhotm+YArtuHECQQDFpNR2ElGp61Aeuzuh
/5s3MnZwIJgQIiMg/aTgdVcU2bsEdcD1aRtnMn/P9TpZZMU8+ylJ5nm2kuiceJi+
lGX3AkAG8lwqnwTkpbCeB+ciNHKIuLq/uW1ztPNMg8R5VM0LwYl+lfz4enDLgpkZ
AKl33ldg92UzNrrzVxwhGYqH1h6BAkAp7NMc0Ln9/2qZekImFSCJzuyM0H0xPuyQ
vP1Sl9GHHMCtK4VpCYjElVPDe1OLTvMAAo85m+hJsFQjjPlpw/T1AkBYTB1Lr2Zu
r4wV3z/Z7yunUMWRq/0aXhezl+SB8qYBo09sRPgbLX3v4qxNSHZWX5UNYk752ruV
XnfIY7T5hcBT
-----END PRIVATE KEY-----
`);

import define from './backend.ts';
import { Memory } from '../memory.ts';
import { Asymetric } from '../asymetric.ts';

describe('Encryption', () => {
	define(new Asymetric(new Memory(), key));
});
