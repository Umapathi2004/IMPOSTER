import { Routes } from '@angular/router';
import { HomeScreen } from './screens/home-screen/home-screen';
import { CreateRoom } from './screens/create-room/create-room';
import { WordCategory } from './screens/word-category/word-category';
import { Lobby } from './screens/lobby/lobby';
import { JoinRoom } from './screens/join-room/join-room';

export const routes: Routes = [
    { path: '', component: HomeScreen },
    { path: 'create-room', component: CreateRoom },
    { path: 'word-category', component: WordCategory },
    { path: 'lobby/:id', component: Lobby },
    { path: 'join', component: JoinRoom },
];
