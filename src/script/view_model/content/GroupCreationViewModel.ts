/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

import {WebAppEvents} from '@wireapp/webapp-events';
import {RECEIPT_MODE} from '@wireapp/api-client/src/conversation/data/ConversationReceiptModeUpdateData';
import ko from 'knockout';
import {amplify} from 'amplify';
import {container} from 'tsyringe';

import {t} from 'Util/LocalizerUtil';
import {onEscKey, offEscKey} from 'Util/KeyboardUtil';
import {sortUsersByPriority} from 'Util/StringUtil';

import {ACCESS_STATE, TEAM} from '../../conversation/AccessState';
import {ConversationRepository} from '../../conversation/ConversationRepository';
import {User} from '../../entity/User';
import {SearchRepository} from '../../search/SearchRepository';
import {UserState} from '../../user/UserState';
import {TeamState} from '../../team/TeamState';
import {TeamRepository} from 'src/script/team/TeamRepository';

type GroupCreationSource = 'start_ui' | 'conversation_details' | 'create';

export class GroupCreationViewModel {
  isTeam: ko.PureComputed<boolean>;
  isShown: ko.Observable<boolean>;
  state: ko.Observable<string>;
  private isCreatingConversation: boolean;
  groupCreationSource: GroupCreationSource;
  nameError: ko.Observable<string>;
  selectedContacts: ko.ObservableArray<User>;
  showContacts: ko.Observable<boolean>;
  participantsInput: ko.Observable<string>;
  accessState: ko.Observable<TEAM>;
  isGuestRoom: ko.PureComputed<boolean>;
  isGuestEnabled: ko.PureComputed<boolean>;
  isTeamOnly: ko.PureComputed<boolean>;
  isGuestAndServicesRoom: ko.PureComputed<boolean>;
  isServicesRoom: ko.PureComputed<boolean>;
  isServicesEnabled: ko.PureComputed<boolean>;
  enableReadReceipts: ko.Observable<boolean>;
  contacts: ko.PureComputed<User[]>;
  participantsActionText: ko.PureComputed<string>;
  participantsHeaderText: ko.PureComputed<string>;
  stateIsPreferences: ko.PureComputed<boolean>;
  stateIsParticipants: ko.PureComputed<boolean>;
  shouldUpdateScrollbar: ko.Computed<User[]>;
  maxNameLength: number;
  maxSize: number;

  // onGroupNameBlur,
  // onChange: onGroupNameChange,
  // onKeyDown: onGroupNameKeydown,
  groupName: ko.Observable<string>;

  static get STATE() {
    return {
      DEFAULT: 'GroupCreationViewModel.STATE.DEFAULT',
      PARTICIPANTS: 'GroupCreationViewModel.STATE.PARTICIPANTS',
      PREFERENCES: 'GroupCreationViewModel.STATE.PREFERENCES',
    };
  }

  constructor(
    public readonly conversationRepository: ConversationRepository,
    public readonly searchRepository: SearchRepository,
    public readonly teamRepository: TeamRepository,
    private readonly userState = container.resolve(UserState),
    private readonly teamState = container.resolve(TeamState),
  ) {
    this.groupName = ko.observable('');
    this.isTeam = this.teamState.isTeam;
    this.maxNameLength = ConversationRepository.CONFIG.GROUP.MAX_NAME_LENGTH;
    this.maxSize = ConversationRepository.CONFIG.GROUP.MAX_SIZE;

    this.isShown = ko.observable(false);
    this.state = ko.observable(GroupCreationViewModel.STATE.DEFAULT);

    this.isCreatingConversation = false;
    this.groupCreationSource = undefined;
    this.nameError = ko.observable('');
    this.selectedContacts = ko.observableArray([]);
    this.showContacts = ko.observable(false);
    this.participantsInput = ko.observable('');
    this.accessState = ko.observable(ACCESS_STATE.TEAM.GUESTS_SERVICES);

    this.isServicesRoom = ko.pureComputed(() => this.accessState() === ACCESS_STATE.TEAM.SERVICES);
    this.isGuestAndServicesRoom = ko.pureComputed(() => this.accessState() === ACCESS_STATE.TEAM.GUESTS_SERVICES);
    this.isGuestRoom = ko.pureComputed(() => this.accessState() === ACCESS_STATE.TEAM.GUEST_ROOM);
    this.isTeamOnly = ko.pureComputed(() => this.accessState() === ACCESS_STATE.TEAM.TEAM_ONLY);

    this.isGuestEnabled = ko.pureComputed(() => this.isGuestRoom() || this.isGuestAndServicesRoom());
    this.isServicesEnabled = ko.pureComputed(() => this.isServicesRoom() || this.isGuestAndServicesRoom());

    this.isGuestEnabled.subscribe((isGuestEnabled: boolean) => {
      if (!isGuestEnabled) {
        this.selectedContacts.remove((userEntity: User) => !userEntity.isTeamMember());
      }
    });

    this.enableReadReceipts = ko.observable(false);

    this.contacts = ko.pureComputed(() => {
      if (this.showContacts()) {
        if (!this.isTeam()) {
          return this.userState.connectedUsers();
        }

        if (this.isGuestEnabled()) {
          return this.teamState.teamUsers();
        }

        return this.teamState.teamMembers().sort(sortUsersByPriority);
      }
      return [];
    });
    this.participantsActionText = ko.pureComputed(() =>
      this.selectedContacts().length
        ? t('groupCreationParticipantsActionCreate')
        : t('groupCreationParticipantsActionSkip'),
    );
    this.participantsHeaderText = ko.pureComputed(() =>
      this.selectedContacts().length
        ? t('groupCreationParticipantsHeaderWithCounter', this.selectedContacts().length)
        : t('groupCreationParticipantsHeader'),
    );
    this.stateIsPreferences = ko.pureComputed(() => this.state() === GroupCreationViewModel.STATE.PREFERENCES);
    this.stateIsParticipants = ko.pureComputed(() => this.state() === GroupCreationViewModel.STATE.PARTICIPANTS);

    const onEscape = () => this.isShown(false);
    this.stateIsPreferences.subscribe((stateIsPreference: boolean): void => {
      if (stateIsPreference) {
        onEscKey(onEscape);
        return;
      }
      offEscKey(onEscape);
    });

    this.stateIsParticipants.subscribe((stateIsParticipants: boolean): void => {
      if (stateIsParticipants) {
        window.setTimeout(() => this.showContacts(true));
        return;
      }
      this.showContacts(false);
    });

    this.shouldUpdateScrollbar = ko
      .computed(() => this.selectedContacts() && this.stateIsPreferences() && this.contacts())
      .extend({notify: 'always', rateLimit: 500});

    amplify.subscribe(WebAppEvents.CONVERSATION.CREATE_GROUP, this.showCreateGroup);
  }

  readonly onGroupNameCancel = () => {
    this.groupName('');
  };

  readonly onGroupNameChange = (event: Event) => {
    event.preventDefault();
    const {value} = event.target as HTMLInputElement;

    const trimmedNameInput = value.trim();
    const nameTooLong = trimmedNameInput.length > this.maxNameLength;
    const nameTooShort = !trimmedNameInput.length;

    this.groupName(value);
    if (nameTooLong) {
      return this.nameError(t('groupCreationPreferencesErrorNameLong'));
    } else if (nameTooShort) {
      return this.nameError(t('groupCreationPreferencesErrorNameShort'));
    }
    this.nameError('');
  };

  readonly onGroupNameBlur = (event: Event) => {
    event.preventDefault();
    const {value} = event.target as HTMLInputElement;

    const trimmedName = value.trim();
    this.groupName(trimmedName);
  };

  readonly showCreateGroup = (groupCreationSource: GroupCreationSource, userEntity: User) => {
    this.groupCreationSource = groupCreationSource;
    this.enableReadReceipts(this.isTeam());
    this.isShown(true);
    this.state(GroupCreationViewModel.STATE.PREFERENCES);
    if (userEntity) {
      this.selectedContacts.push(userEntity);
    }
  };

  readonly clickOnBack = (): void => {
    this.state(GroupCreationViewModel.STATE.PREFERENCES);
  };

  readonly clickOnClose = (): void => {
    this.isShown(false);
  };

  readonly clickOnToggleServicesMode = (): void => {
    let newAccessState: TEAM;

    if (this.isGuestRoom()) {
      newAccessState = ACCESS_STATE.TEAM.GUESTS_SERVICES;
    }

    if (this.isGuestAndServicesRoom()) {
      newAccessState = ACCESS_STATE.TEAM.GUEST_ROOM;
    }
    if (this.isServicesRoom()) {
      newAccessState = ACCESS_STATE.TEAM.TEAM_ONLY;
    }
    if (this.isTeamOnly()) {
      newAccessState = ACCESS_STATE.TEAM.SERVICES;
    }

    this.accessState(newAccessState);
  };
  readonly clickOnToggleGuestMode = (): void => {
    let newAccessState: TEAM;

    if (this.isServicesRoom()) {
      newAccessState = ACCESS_STATE.TEAM.GUESTS_SERVICES;
    }
    if (this.isTeamOnly()) {
      newAccessState = ACCESS_STATE.TEAM.GUEST_ROOM;
    }
    if (this.isGuestRoom()) {
      newAccessState = ACCESS_STATE.TEAM.TEAM_ONLY;
    }
    if (this.isGuestAndServicesRoom()) {
      newAccessState = ACCESS_STATE.TEAM.SERVICES;
    }

    this.accessState(newAccessState);
  };

  clickOnCreate = async (): Promise<void> => {
    if (!this.isCreatingConversation) {
      this.isCreatingConversation = true;

      const accessState = this.isTeam() ? this.accessState() : undefined;
      const options = {
        receipt_mode: this.enableReadReceipts() ? RECEIPT_MODE.ON : RECEIPT_MODE.OFF,
      };

      try {
        const conversationEntity = await this.conversationRepository.createGroupConversation(
          this.selectedContacts(),
          this.groupName(),
          accessState,
          options,
        );
        this.isShown(false);

        amplify.publish(WebAppEvents.CONVERSATION.SHOW, conversationEntity, {});
      } catch (error) {
        this.isCreatingConversation = false;
        throw error;
      }
    }
  };

  readonly clickOnNext = (): void => {
    this.state(GroupCreationViewModel.STATE.PARTICIPANTS);
  };

  readonly afterHideModal = (): void => {
    this.isCreatingConversation = false;
    this.groupCreationSource = undefined;
    this.nameError('');
    this.groupName('');
    this.participantsInput('');
    this.selectedContacts([]);
    this.state(GroupCreationViewModel.STATE.DEFAULT);
    this.accessState(ACCESS_STATE.TEAM.GUESTS_SERVICES);
  };
}
