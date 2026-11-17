import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
    let app: INestApplication<Server>;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    it('/ (GET)', () => {
        return request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
    });

    it.each(['/resume/editor', '/pdf/editor', '/resumes/editor.js'])('leaves %s to the frontend', (path) =>
        request(app.getHttpServer()).get(path).expect(404),
    );

    afterEach(async () => {
        await app.close();
    });
});
